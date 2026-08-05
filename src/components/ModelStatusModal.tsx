import { useState, useEffect } from "react";
import { 
  X, 
  Activity, 
  CheckCircle2, 
  Gauge,
  AlertTriangle, 
  XCircle, 
  HelpCircle,
  Lock
} from "lucide-react";
import { LLMConfig } from "../types";
import { 
  getAllModelStatuses, 
  ModelStatusItem, 
  ModelStatusIndicator 
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

  useEffect(() => {
    if (isOpen) {
      const list = getAllModelStatuses(llmConfig);
      setModelStatuses(list);
    }
  }, [isOpen, llmConfig]);

  if (!isOpen) return null;

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
        {/* Header */}
        <div className="px-5 py-4 border-b border-stone-200 flex items-center justify-between gap-3 bg-stone-50/80">
          <div className="flex items-center gap-2.5">
            <Activity className="w-5 h-5 text-amber-500 shrink-0" />
            <div>
              <h2 className="text-base font-bold text-stone-900 leading-tight">
                Model Status
              </h2>
              <p className="text-xs text-stone-500">Sorted fastest response first</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 rounded-lg transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* View-Only Model List */}
        <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
          {modelStatuses.map((item, index) => {
            const isActive = llmConfig.provider === item.provider && llmConfig.model === item.model;
            const rank = index + 1;

            return (
              <div
                key={`${item.provider}:${item.model}`}
                className={`p-3.5 rounded-xl border flex flex-col gap-2.5 transition-colors ${
                  isActive
                    ? "bg-amber-50/60 border-amber-300"
                    : "bg-white border-stone-200/90 hover:bg-stone-50/60"
                }`}
              >
                {/* Top Row: Rank, Model Name, Provider & Status Badges */}
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

                {/* Bottom Row: Response Time & State Indicator */}
                <div className="flex items-center justify-between pt-2 border-t border-stone-100/80 text-xs">
                  <div className="flex items-center gap-1.5 text-stone-500 font-mono">
                    <span className="text-[11px] text-stone-400">Response time:</span>
                    <span className="font-semibold text-stone-800 text-xs">
                      {formatResponseTime(item.lastResponseTimeMs)}
                    </span>
                  </div>

                  <div>
                    {getStatusBadge(item.status)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
