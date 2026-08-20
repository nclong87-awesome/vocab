import { useState, useEffect } from "react";
import { 
  X, 
  Activity, 
  CheckCircle2, 
  Gauge,
  AlertTriangle, 
  Clock,
  BarChart2,
  Zap,
  Layers,
  RotateCcw,
  Unlock,
  Lock,
} from "lucide-react";
import { LLMConfig } from "../types";
import { 
  getAllModelStatuses, 
  ModelStatusItem, 
  ModelStatusIndicator,
  resetAllModelStates,
  getPerformanceTierMeta,
  PerformanceTierNumber,
  isMetricStale,
  unlockModel,
} from "../utils/autoModeManager";

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
  const [tierFilter, setTierFilter] = useState<'all' | PerformanceTierNumber>('all');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const refreshStatuses = () => {
    const list = getAllModelStatuses(llmConfig);
    setModelStatuses(list);
  };

  const handleClose = () => {
    onClose();
  };

  const handleResetEverything = () => {
    resetAllModelStates();
    refreshStatuses();
    setToastMessage("All model states, response times, success rates, logs, and locks reset!");
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleUnlockSingleModel = (provider: string, model: string) => {
    unlockModel(provider, model);
    refreshStatuses();
    setToastMessage(`Model "${model}" successfully unlocked!`);
    setTimeout(() => setToastMessage(null), 2500);
  };

  useEffect(() => {
    if (isOpen) {
      refreshStatuses();
    }
  }, [isOpen, llmConfig]);

  if (!isOpen) return null;

  const getStatusBadge = (status: ModelStatusIndicator) => {
    switch (status) {
      case 'strong':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200" title="Fast: 0–14s">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>Fast</span>
          </span>
        );
      case 'medium':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200" title="Medium: 15–24s">
            <Gauge className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span>Medium</span>
          </span>
        );
      case 'weak':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-orange-50 text-orange-700 border border-orange-200" title="Slow: 25s or more">
            <AlertTriangle className="w-3.5 h-3.5 text-orange-600 shrink-0" />
            <span>Slow</span>
          </span>
        );
      case 'offline':
        // User requested removing the Offline tag/badge entirely.
        return null;
      case 'untested':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-600 border border-stone-200">
            <Clock className="w-3.5 h-3.5 text-stone-400 shrink-0" />
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

  const formatUnlockTime = (expiresAt?: number) => {
    if (!expiresAt) return "Soon";
    try {
      const now = Date.now();
      const diffMs = expiresAt - now;
      if (diffMs <= 0) return "Expiring now";

      const diffMinutes = Math.ceil(diffMs / (60 * 1000));
      const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
      const remainingMins = diffMinutes % 60;
      const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));

      let relativeStr = "";
      if (diffDays >= 1) {
        const remHours = Math.floor((diffMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
        relativeStr = remHours > 0 ? `${diffDays}d ${remHours}h` : `${diffDays}d`;
      } else if (diffHours >= 1) {
        relativeStr = remainingMins > 0 ? `${diffHours}h ${remainingMins}m` : `${diffHours}h`;
      } else {
        relativeStr = `${diffMinutes}m`;
      }

      const d = new Date(expiresAt);
      const isToday = new Date().toDateString() === d.toDateString();
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const isTomorrow = tomorrow.toDateString() === d.toDateString();

      const timeStr = d.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit"
      });

      if (isToday) {
        return `Today at ${timeStr} (in ${relativeStr})`;
      } else if (isTomorrow) {
        return `Tomorrow at ${timeStr} (in ${relativeStr})`;
      } else {
        const dateStr = d.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric"
        });
        return `${dateStr}, ${timeStr} (in ${relativeStr})`;
      }
    } catch {
      return "Soon";
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-stone-950/50 backdrop-blur-xs z-50 flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={handleClose}
      id="model-status-modal"
    >
      <div 
        className="bg-white rounded-2xl border border-stone-200 shadow-xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Toast Feedback Notification Banner */}
        {toastMessage && (
          <div className="bg-emerald-600 text-white text-xs font-semibold px-4 py-2 flex items-center justify-between gap-2 shadow-sm animate-in fade-in duration-150 shrink-0">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-200 shrink-0" />
              <span>{toastMessage}</span>
            </div>
            <button 
              type="button" 
              onClick={() => setToastMessage(null)}
              className="text-emerald-200 hover:text-white cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-stone-200 flex items-center justify-between gap-2 bg-stone-50/80 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <Activity className="w-5 h-5 text-amber-500 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-base font-bold text-stone-900 leading-tight truncate">
                Model Status
              </h2>
              <p className="text-xs text-stone-500 truncate">Avg of last 10 requests (skips errors) • Sorted fastest first</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleResetEverything}
              className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 active:bg-rose-200 text-rose-700 border border-rose-200/90 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
              title="Reset all models' metrics, response times, and locks"
              id="reset-model-state-header-btn"
            >
              <RotateCcw className="w-3.5 h-3.5 text-rose-600 shrink-0" />
              <span className="hidden sm:inline">Reset All State</span>
              <span className="sm:hidden">Reset All</span>
            </button>

            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 rounded-lg transition-colors cursor-pointer shrink-0"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Model Status List */}
        <div className="p-4 overflow-y-auto space-y-3 flex-1">
          {/* Tier Filter Tabs */}
          <div className="flex items-center gap-1.5 pb-2 border-b border-stone-100 overflow-x-auto no-scrollbar shrink-0 text-xs">
            <span className="text-stone-500 font-medium flex items-center gap-1 text-[11px] shrink-0 mr-1">
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
              Tier 2: Medium ({modelStatuses.filter(m => m.performanceTier === 2).length})
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

          {/* Model List Items */}
          {modelStatuses
            .filter(item => tierFilter === 'all' || item.performanceTier === tierFilter)
            .map((item, index) => {
              const isActive = llmConfig.provider === item.provider && llmConfig.model === item.model;
              const rank = index + 1;
              const itemKey = `${item.provider}:${item.model}`;
              const isStale = isMetricStale(item.lastTestedAt);
              const isUntestedOrStale = item.status === 'untested' || item.lastResponseTimeMs === null || isStale;
              const tierMeta = getPerformanceTierMeta(item.performanceTier, isUntestedOrStale);

              const successStats = formatSuccessRate(item.totalSuccesses, item.totalCalls);

              return (
                <div
                  key={itemKey}
                  className={`p-3.5 rounded-xl border flex flex-col gap-2.5 transition-colors overflow-hidden ${
                    isActive
                      ? "bg-amber-50/60 border-amber-300 shadow-xs"
                      : "bg-white border-stone-200/90 hover:bg-stone-50/60"
                  }`}
                >
                  {/* Top Row: Rank, Model Name, Provider, Tier & Status Badges */}
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span className={`w-6 h-6 rounded-md text-xs font-mono font-bold flex items-center justify-center shrink-0 mt-0.5 ${
                      rank === 1 && !item.isLocked
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
                      {/* Average Response Time */}
                      <div 
                        className="flex items-center gap-1.5 text-[11px]" 
                        title="Average response time calculated based on the last 10 requests (skipping failed requests)"
                      >
                        <span className="text-stone-400 flex items-center gap-0.5">
                          <Clock className="w-3 h-3 text-stone-400" />
                          Avg Time:
                        </span>
                        <span className="font-semibold text-stone-800 text-xs">
                          {formatResponseTime(item.avgResponseTimeMs ?? item.lastResponseTimeMs)}
                        </span>
                        {item.recentResponseTimes && item.recentResponseTimes.length > 0 && (
                          <span 
                            className="text-[10px] text-stone-500 font-sans font-medium bg-stone-100 px-1.5 py-0.2 rounded border border-stone-200/80" 
                            title={`Calculated from ${item.recentResponseTimes.length} successful request(s)`}
                          >
                            {item.recentResponseTimes.length} {item.recentResponseTimes.length === 1 ? 'req' : 'reqs'}
                          </span>
                        )}
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

                  {/* bottom drawer for locked models: display exactly when it will unlock, plus instant action to unlock now */}
                  {item.isLocked && (
                    <div className="flex items-center justify-between pt-2.5 border-t border-rose-100 mt-1 bg-rose-50/50 -mx-3.5 -mb-3.5 p-3 rounded-b-xl animate-in slide-in-from-bottom duration-150">
                      <div className="flex items-center gap-1.5 text-rose-800 text-xs font-semibold">
                        <Clock className="w-3.5 h-3.5 text-rose-500 shrink-0 animate-pulse" />
                        <span>
                          Unlocks at <span className="font-bold text-rose-950 font-mono bg-rose-100 px-1.5 py-0.5 rounded">{formatUnlockTime(item.expiresAt)}</span>
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUnlockSingleModel(item.provider, item.model)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-lg transition-all shadow-xs hover:shadow-sm cursor-pointer shrink-0"
                      >
                        <Unlock className="w-3 h-3 shrink-0" />
                        <span>Unlock Now</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
