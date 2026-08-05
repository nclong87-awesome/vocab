import { useState, useEffect } from "react";
import { 
  X, 
  Activity, 
  CheckCircle2, 
  Gauge,
  AlertTriangle, 
  XCircle, 
  HelpCircle,
  Lock,
  FileText,
  ArrowLeft,
  Trash2,
  Play,
  Loader2,
  Clock,
  BarChart2,
  Zap,
  ShieldCheck,
  Layers,
  Info
} from "lucide-react";
import { LLMConfig } from "../types";
import { 
  getAllModelStatuses, 
  ModelStatusItem, 
  ModelStatusIndicator,
  clearModelFailureLogs,
  getPerformanceTierMeta,
  PerformanceTierNumber,
  isMetricStale
} from "../utils/autoModeManager";
import { testSingleModelStatus } from "../services/llmClientService";

interface ModelStatusModalProps {
  isOpen: boolean;
  onClose: () => void;
  llmConfig: LLMConfig;
}

export default function ModelStatusModal({
  isOpen,
  onClose,
  llmConfig
}: ModelStatusModalProps) {
  const [modelStatuses, setModelStatuses] = useState<ModelStatusItem[]>([]);
  const [selectedLogsModel, setSelectedLogsModel] = useState<ModelStatusItem | null>(null);
  const [testingModelKey, setTestingModelKey] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState<'all' | PerformanceTierNumber>('all');
  const [showTierExplanation, setShowTierExplanation] = useState(true);

  const refreshStatuses = () => {
    const list = getAllModelStatuses(llmConfig);
    setModelStatuses(list);
    if (selectedLogsModel) {
      const updatedSelected = list.find(
        m => m.provider === selectedLogsModel.provider && m.model === selectedLogsModel.model
      );
      if (updatedSelected) {
        setSelectedLogsModel(updatedSelected);
      }
    }
  };

  useEffect(() => {
    if (isOpen) {
      refreshStatuses();
    } else {
      setSelectedLogsModel(null);
      setTestingModelKey(null);
    }
  }, [isOpen, llmConfig]);

  if (!isOpen) return null;

  const handleTestModel = async (provider: any, model: string) => {
    const key = `${provider}:${model}`;
    setTestingModelKey(key);
    try {
      await testSingleModelStatus(provider, model, llmConfig);
    } finally {
      setTestingModelKey(null);
      refreshStatuses();
    }
  };

  const handleClearLogs = (provider: string, model: string) => {
    clearModelFailureLogs(provider, model);
    refreshStatuses();
  };

  const getStatusBadge = (status: ModelStatusIndicator) => {
    switch (status) {
      case 'strong':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>Strong</span>
          </span>
        );
      case 'medium':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
            <Gauge className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span>Medium</span>
          </span>
        );
      case 'weak':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-50 text-orange-700 border border-orange-200">
            <AlertTriangle className="w-3.5 h-3.5 text-orange-600 shrink-0" />
            <span>Weak</span>
          </span>
        );
      case 'offline':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
            <span>Offline</span>
          </span>
        );
      case 'untested':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-600 border border-stone-200">
            <HelpCircle className="w-3.5 h-3.5 text-stone-400 shrink-0" />
            <span>Untested</span>
          </span>
        );
    }
  };

  const formatResponseTime = (ms: number | null) => {
    if (ms === null || ms === undefined) return "--";
    if (ms < 1000) return `${ms} ms`;
    return `${(ms / 1000).toFixed(2)} s`;
  };

  const formatSuccessRate = (successes: number, total: number) => {
    if (!total || total <= 0) return { percentStr: "--", countStr: "(0 calls)", rate: null };
    const percent = Math.round((successes / total) * 100);
    return {
      percentStr: `${percent}%`,
      countStr: `(${successes}/${total})`,
      rate: percent
    };
  };

  const formatTimestamp = (ts: number) => {
    try {
      const d = new Date(ts);
      return d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    } catch {
      return String(ts);
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-stone-950/50 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
      id="model-status-modal"
    >
      <div 
        className="bg-white rounded-2xl border border-stone-200 shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between gap-3 bg-stone-50/80">
          {selectedLogsModel ? (
            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => setSelectedLogsModel(null)}
                className="p-1 text-stone-500 hover:text-stone-800 hover:bg-stone-200/70 rounded-lg transition-colors cursor-pointer flex items-center gap-1 text-xs font-medium"
                title="Back to model list"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
              <div>
                <h2 className="text-base font-bold text-stone-900 leading-tight flex items-center gap-2">
                  <span>Failure Logs</span>
                  <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-md bg-stone-200 text-stone-700">
                    {selectedLogsModel.model}
                  </span>
                </h2>
                <p className="text-xs text-stone-500">
                  {selectedLogsModel.providerName} • Showing up to 10 most recent failures
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5">
              <Activity className="w-5 h-5 text-amber-500 shrink-0" />
              <div>
                <h2 className="text-base font-bold text-stone-900 leading-tight">
                  Model Status
                </h2>
                <p className="text-xs text-stone-500">Sorted fastest response first</p>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 rounded-lg transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* View 1: Failure Logs View */}
        {selectedLogsModel ? (
          <div className="p-4 overflow-y-auto flex-1 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-stone-100 text-xs">
              <div className="flex items-center gap-2 text-stone-600 font-medium">
                <FileText className="w-4 h-4 text-rose-500" />
                <span>Total Recorded Failures: {selectedLogsModel.failureLogs.length}</span>
              </div>
              {selectedLogsModel.failureLogs.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleClearLogs(selectedLogsModel.provider, selectedLogsModel.model)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-stone-600 hover:text-rose-700 hover:bg-rose-50 border border-stone-200 transition-colors cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-stone-400 hover:text-rose-500" />
                  <span>Clear Logs</span>
                </button>
              )}
            </div>

            {selectedLogsModel.failureLogs.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-center p-6 bg-stone-50/50 rounded-xl border border-dashed border-stone-200">
                <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-2" />
                <h3 className="text-sm font-semibold text-stone-800">No Failure Logs Recorded</h3>
                <p className="text-xs text-stone-500 max-w-sm mt-1">
                  All requests to <span className="font-mono font-medium">{selectedLogsModel.model}</span> have succeeded, or no failures have been logged yet.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {selectedLogsModel.failureLogs.map((log, idx) => (
                  <div
                    key={log.id || idx}
                    className="p-3.5 rounded-xl bg-white border border-stone-200 shadow-xs flex flex-col gap-2 transition-all"
                  >
                    <div className="flex items-center justify-between text-xs text-stone-500">
                      <span className="font-mono font-bold text-stone-700 bg-stone-100 px-2 py-0.5 rounded text-[11px]">
                        Entry #{idx + 1}
                      </span>
                      <span className="flex items-center gap-1 text-stone-400 font-mono text-[11px]">
                        <Clock className="w-3 h-3" />
                        {formatTimestamp(log.timestamp)}
                      </span>
                    </div>

                    <div className="bg-rose-50/80 border border-rose-200/90 rounded-lg p-3 text-rose-950 font-mono text-xs break-all leading-relaxed whitespace-pre-wrap select-text">
                      <span className="font-bold text-rose-700 block mb-0.5 text-[11px] uppercase tracking-wider">
                        Failure Reason:
                      </span>
                      {log.reason}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="p-4 overflow-y-auto space-y-3 flex-1">
            {/* Performance-Tiered Priority Routing Explanation Banner */}
            {showTierExplanation && (
              <div className="p-3.5 bg-gradient-to-r from-amber-500/10 via-amber-50 to-amber-500/5 rounded-xl border border-amber-200/90 text-stone-800 text-xs space-y-2 relative animate-in fade-in duration-150">
                <button
                  type="button"
                  onClick={() => setShowTierExplanation(false)}
                  className="absolute top-2.5 right-2.5 p-1 text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 rounded-md transition-colors cursor-pointer"
                  title="Dismiss explanation"
                >
                  <X className="w-3.5 h-3.5" />
                </button>

                <div className="flex items-center gap-2 font-bold text-amber-900">
                  <ShieldCheck className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Performance-Tiered Priority Routing & Dynamic Re-Evaluation Active</span>
                </div>

                <p className="text-stone-700 leading-relaxed text-[11px]">
                  <strong>1. Untested Models:</strong> Newly added or untested models are automatically placed in <strong className="text-sky-800">Tier 1 (Probe Queue)</strong> to immediately benchmark their speed.<br/>
                  <strong>2. Continuous Re-Evaluation:</strong> Slower models in Tier 2 and Tier 4 are re-evaluated via <strong>15% Epsilon Exploration</strong> and <strong>15m Metric Expiration</strong>. If their speed recovers, they are automatically promoted to Tier 1!
                </p>

                <div className="grid grid-cols-2 xs:grid-cols-4 gap-1.5 pt-1 text-[10px]">
                  <div className="px-2 py-1 rounded bg-emerald-100/80 border border-emerald-200 text-emerald-900 font-medium flex items-center justify-between">
                    <span>Tier 1: Fast / Probe</span>
                    <span className="font-mono font-bold text-emerald-700">&lt;10s / New</span>
                  </div>
                  <div className="px-2 py-1 rounded bg-amber-100/80 border border-amber-200 text-amber-900 font-medium flex items-center justify-between">
                    <span>Tier 2: Balanced</span>
                    <span className="font-mono font-bold text-amber-700">10-20s</span>
                  </div>
                  <div className="px-2 py-1 rounded bg-stone-100 border border-stone-200 text-stone-800 font-medium flex items-center justify-between">
                    <span>Tier 3: Backup</span>
                    <span className="font-mono text-stone-600">Secondary</span>
                  </div>
                  <div className="px-2 py-1 rounded bg-orange-100/80 border border-orange-200 text-orange-900 font-medium flex items-center justify-between">
                    <span>Tier 4: Demoted</span>
                    <span className="font-mono font-bold text-orange-800">&gt;20s</span>
                  </div>
                </div>
              </div>
            )}

            {/* Tier Filter Tabs */}
            <div className="flex items-center justify-between gap-2 pb-1 border-b border-stone-100 overflow-x-auto">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-stone-500 font-medium flex items-center gap-1 text-[11px] shrink-0">
                  <Layers className="w-3.5 h-3.5 text-stone-400" />
                  <span>Filter Tier:</span>
                </span>
                <button
                  type="button"
                  onClick={() => setTierFilter('all')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer shrink-0 ${
                    tierFilter === 'all'
                      ? "bg-stone-900 text-white shadow-2xs"
                      : "bg-stone-100 text-stone-600 hover:bg-stone-200/80"
                  }`}
                >
                  All ({modelStatuses.length})
                </button>
                <button
                  type="button"
                  onClick={() => setTierFilter(1)}
                  className={`px-2 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer shrink-0 ${
                    tierFilter === 1
                      ? "bg-emerald-700 text-white shadow-2xs"
                      : "bg-emerald-50 text-emerald-800 border border-emerald-200/80 hover:bg-emerald-100"
                  }`}
                >
                  Tier 1: Fast ({modelStatuses.filter(m => m.performanceTier === 1).length})
                </button>
                <button
                  type="button"
                  onClick={() => setTierFilter(2)}
                  className={`px-2 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer shrink-0 ${
                    tierFilter === 2
                      ? "bg-amber-700 text-white shadow-2xs"
                      : "bg-amber-50 text-amber-800 border border-amber-200/80 hover:bg-amber-100"
                  }`}
                >
                  Tier 2: Balanced ({modelStatuses.filter(m => m.performanceTier === 2).length})
                </button>
                <button
                  type="button"
                  onClick={() => setTierFilter(3)}
                  className={`px-2 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer shrink-0 ${
                    tierFilter === 3
                      ? "bg-stone-800 text-white shadow-2xs"
                      : "bg-stone-100 text-stone-700 border border-stone-200 hover:bg-stone-200/80"
                  }`}
                >
                  Tier 3 ({modelStatuses.filter(m => m.performanceTier === 3).length})
                </button>
                <button
                  type="button"
                  onClick={() => setTierFilter(4)}
                  className={`px-2 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer shrink-0 ${
                    tierFilter === 4
                      ? "bg-orange-800 text-white shadow-2xs"
                      : "bg-orange-50 text-orange-900 border border-orange-200 hover:bg-orange-100"
                  }`}
                >
                  Tier 4: Slow ({modelStatuses.filter(m => m.performanceTier === 4).length})
                </button>
              </div>

              {!showTierExplanation && (
                <button
                  type="button"
                  onClick={() => setShowTierExplanation(true)}
                  className="p-1 text-amber-600 hover:text-amber-800 hover:bg-amber-50 rounded transition-colors cursor-pointer shrink-0 text-xs font-semibold flex items-center gap-1"
                  title="Show Tier explanation"
                >
                  <Info className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Info</span>
                </button>
              )}
            </div>

            {/* Model List Items */}
            {modelStatuses
              .filter(item => tierFilter === 'all' || item.performanceTier === tierFilter)
              .map((item, index) => {
                const isActive = llmConfig.provider === item.provider && llmConfig.model === item.model;
                const rank = index + 1;
                const itemKey = `${item.provider}:${item.model}`;
                const isTesting = testingModelKey === itemKey;
                const isStale = isMetricStale(item.lastTestedAt);
                const isUntestedOrStale = item.status === 'untested' || item.lastResponseTimeMs === null || isStale;
                const tierMeta = getPerformanceTierMeta(item.performanceTier, isUntestedOrStale);

                const successStats = formatSuccessRate(item.totalSuccesses, item.totalCalls);

                return (
                  <div
                    key={itemKey}
                    className={`p-3.5 rounded-xl border flex flex-col gap-2.5 transition-colors ${
                      isActive
                        ? "bg-amber-50/60 border-amber-300"
                        : "bg-white border-stone-200/90 hover:bg-stone-50/60"
                    }`}
                  >
                    {/* Top Row: Rank, Model Name, Provider, Tier & Status Badges */}
                    <div className="flex items-start gap-2.5 min-w-0">
                      <span className={`w-6 h-6 rounded-md text-xs font-mono font-bold flex items-center justify-center shrink-0 mt-0.5 ${
                        rank === 1 && item.status !== 'offline'
                          ? "bg-amber-400 text-stone-950"
                          : "bg-stone-100 text-stone-500"
                      }`}>
                        #{rank}
                      </span>

                      <div className="min-w-0 flex-1 flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-xs text-stone-900 font-mono break-all" title={item.model}>
                          {item.model}
                        </span>

                        <span className="text-[11px] font-medium text-stone-600 bg-stone-100 px-2 py-0.5 rounded-md border border-stone-200/80 shrink-0">
                          {item.providerName}
                        </span>

                        {/* Performance Tier Badge */}
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border shrink-0 flex items-center gap-1 ${tierMeta.colorClass}`} title={tierMeta.description}>
                          <Zap className="w-3 h-3 shrink-0" />
                          <span>{tierMeta.badgeLabel}</span>
                        </span>

                        {isActive && (
                          <span className="text-[10px] font-bold text-amber-800 bg-amber-200/80 px-1.5 py-0.5 rounded shrink-0">
                            Active
                          </span>
                        )}

                        {item.isLocked && (
                          <span className="text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded flex items-center gap-1 shrink-0">
                            <Lock className="w-3 h-3 text-rose-500" />
                            <span>Locked</span>
                          </span>
                        )}
                      </div>
                    </div>

                  {/* Middle Row: Metrics (Response Time, Success Rate, Status Badge) */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-stone-100/80 text-xs">
                    <div className="flex flex-wrap items-center gap-3 text-stone-500 font-mono">
                      {/* Response Time */}
                      <div className="flex items-center gap-1 text-[11px]">
                        <span className="text-stone-400">Time:</span>
                        <span className="font-semibold text-stone-800 text-xs">
                          {formatResponseTime(item.lastResponseTimeMs)}
                        </span>
                      </div>

                      {/* Success Rate */}
                      <div className="flex items-center gap-1 text-[11px]">
                        <span className="text-stone-400 flex items-center gap-0.5">
                          <BarChart2 className="w-3 h-3 text-stone-400" />
                          Success Rate:
                        </span>
                        <span className={`font-semibold text-xs ${
                          successStats.rate === null
                            ? "text-stone-500"
                            : successStats.rate >= 90
                            ? "text-emerald-700 font-bold"
                            : successStats.rate >= 60
                            ? "text-amber-700 font-bold"
                            : "text-rose-700 font-bold"
                        }`}>
                          {successStats.percentStr}
                        </span>
                        <span className="text-[10px] text-stone-400">
                          {successStats.countStr}
                        </span>
                      </div>
                    </div>

                    <div>
                      {getStatusBadge(item.status)}
                    </div>
                  </div>

                  {/* Bottom Action Row: View Failure Logs Button & Test Button */}
                  <div className="flex items-center justify-between pt-1.5 border-t border-stone-100/60 text-xs">
                    <button
                      type="button"
                      onClick={() => setSelectedLogsModel(item)}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer ${
                        item.failureLogs.length > 0
                          ? "bg-rose-50 text-rose-700 border-rose-200/90 hover:bg-rose-100"
                          : "bg-stone-50 text-stone-600 border-stone-200/90 hover:bg-stone-100 hover:text-stone-800"
                      }`}
                    >
                      <FileText className={`w-3.5 h-3.5 ${item.failureLogs.length > 0 ? "text-rose-500" : "text-stone-400"}`} />
                      <span>Failure Logs ({item.failureLogs.length})</span>
                    </button>

                    <button
                      type="button"
                      disabled={isTesting}
                      onClick={() => handleTestModel(item.provider, item.model)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-stone-100 hover:bg-stone-200/80 text-stone-700 border border-stone-200/90 transition-colors disabled:opacity-50 cursor-pointer"
                      title="Test connection and response time for this model"
                    >
                      {isTesting ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-600" />
                          <span>Testing...</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3 text-stone-500 fill-stone-500" />
                          <span>Test</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
