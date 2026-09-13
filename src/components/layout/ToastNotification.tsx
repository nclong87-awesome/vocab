import React from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Sparkles,
  Loader2,
  X,
  Clock,
  ArrowRight,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import { BatchEnrichmentProgress } from "../../services/backgroundEnrichmentService";

export interface ToastAction {
  label: string;
  onClick: () => void;
  icon?: "sparkles" | "arrow" | "stop";
  variant?: "primary" | "secondary" | "danger";
}

export interface ToastItem {
  id: string;
  message: string;
  subMessage?: string;
  type?: "default" | "success" | "warning" | "error" | "enrichment_progress";
  incompleteCount?: number;
  progress?: BatchEnrichmentProgress;
  action?: ToastAction;
  secondaryAction?: ToastAction;
  onDismiss?: () => void;
}

interface ToastNotificationProps {
  toast: ToastItem | null;
  onClose: () => void;
}

export const ToastNotification: React.FC<ToastNotificationProps> = ({
  toast,
  onClose,
}) => {
  if (!toast) return null;

  const isEnrichmentProgress =
    toast.type === "enrichment_progress" ||
    Boolean(toast.progress && toast.progress.isRunning);

  const progress = toast.progress;
  const percent = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
    : 0;

  return (
    <AnimatePresence>
      <motion.div
        key={toast.id}
        initial={{ opacity: 0, y: 24, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.95 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 w-full max-w-lg pointer-events-auto"
      >
        <div className="bg-stone-900/95 text-stone-100 border border-stone-700/80 rounded-2xl shadow-2xl backdrop-blur-md p-3.5 sm:p-4 space-y-2.5">
          {/* Main Top Row: Icon, Message, Incomplete badge, Dismiss */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              {isEnrichmentProgress ? (
                <div className="w-7 h-7 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              ) : toast.type === "success" ? (
                <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
              ) : toast.type === "warning" ? (
                <div className="w-7 h-7 rounded-lg bg-purple-500/20 border border-purple-500/40 flex items-center justify-center text-purple-400 shrink-0">
                  <AlertCircle className="w-4 h-4" />
                </div>
              ) : (
                <div className="w-7 h-7 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                  <Sparkles className="w-4 h-4" />
                </div>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs sm:text-sm font-semibold text-stone-100 tracking-tight leading-snug">
                    {toast.message}
                  </span>
                  {typeof toast.incompleteCount === "number" && toast.incompleteCount > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                      <Clock className="w-2.5 h-2.5" />
                      <span>{toast.incompleteCount} draft{toast.incompleteCount > 1 ? "s" : ""}</span>
                    </span>
                  )}
                </div>
                {toast.subMessage && (
                  <p className="text-[11px] text-stone-400 mt-0.5 truncate">
                    {toast.subMessage}
                  </p>
                )}
              </div>
            </div>

            {/* Dismiss Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded-lg text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors shrink-0"
              title="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Progress Bar & Details when enrichment is running */}
          {isEnrichmentProgress && progress && (
            <div className="space-y-1.5 pt-0.5">
              <div className="flex items-center justify-between text-[11px] text-stone-300 font-medium">
                <span className="truncate">
                  {progress.currentWordText
                    ? `Enriching: "${progress.currentWordText}"`
                    : `Processing queue...`}
                </span>
                <span className="font-mono text-amber-400 font-bold shrink-0 ml-2">
                  {progress.processed}/{progress.total} ({percent}%)
                </span>
              </div>
              <div className="w-full bg-stone-800 rounded-full h-1.5 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-amber-500 to-amber-400 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          )}

          {/* Bottom Action Buttons (Direct Batch Update shortcut link, View Collection, Stop) */}
          {(toast.action || toast.secondaryAction) && (
            <div className="flex items-center justify-end gap-2 pt-1 border-t border-stone-800/80">
              {toast.secondaryAction && (
                <button
                  type="button"
                  onClick={() => {
                    toast.secondaryAction?.onClick();
                    if (!isEnrichmentProgress) onClose();
                  }}
                  className="px-2.5 py-1 text-xs font-medium rounded-lg text-stone-300 hover:text-white hover:bg-stone-800 transition-colors flex items-center gap-1 cursor-pointer"
                >
                  <span>{toast.secondaryAction.label}</span>
                </button>
              )}

              {toast.action && (
                <button
                  type="button"
                  onClick={() => {
                    toast.action?.onClick();
                    if (!isEnrichmentProgress && toast.action?.variant !== "danger") onClose();
                  }}
                  className={`px-3 py-1.5 text-xs font-bold rounded-lg flex items-center gap-1.5 transition-all cursor-pointer shadow-xs ${
                    toast.action.variant === "danger"
                      ? "bg-rose-600/30 hover:bg-rose-600/40 text-rose-300 border border-rose-500/40"
                      : "bg-amber-500 hover:bg-amber-400 text-stone-950 hover:shadow-amber-500/20"
                  }`}
                >
                  {toast.action.icon === "sparkles" && <Sparkles className="w-3.5 h-3.5" />}
                  {toast.action.icon === "arrow" && <ArrowRight className="w-3.5 h-3.5" />}
                  {toast.action.icon === "stop" && <X className="w-3.5 h-3.5" />}
                  <span>{toast.action.label}</span>
                </button>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};
