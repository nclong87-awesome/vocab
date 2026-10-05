import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { 
  X, 
  Check, 
  Trash2, 
  Flag
} from "lucide-react";
import { ChallengeData, ChallengeEvaluation, PoorSentenceReport } from "../../types";
import { useModalBackNavigation } from "../../hooks/useModalBackNavigation";
import { savePoorSentenceReportToDB, deletePoorSentenceReportFromDB } from "../../db/indexedDB";

interface ReportPoorSentenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  challenge?: ChallengeData;
  evaluation?: ChallengeEvaluation;
  provider?: string;
  model?: string;
  responseTimeMs?: number;
  targetLanguage?: string;
  nativeLanguage?: string;
  existingReport?: PoorSentenceReport | null;
  onReportSaved?: (report: PoorSentenceReport) => void;
  onReportDeleted?: (reportId: string) => void;
  showToast?: (msg: string) => void;
}

const COMMON_REASONS = [
  { id: "unnatural_phrasing", label: "Unnatural Phrasing" },
  { id: "incorrect_translation", label: "Incorrect Translation" },
  { id: "grammar_error", label: "Grammar Error" },
  { id: "target_word_mismatch", label: "Word Mismatch" },
  { id: "poor_topic_context", label: "Awkward Context" },
  { id: "other", label: "Other" },
];

export default function ReportPoorSentenceModal({
  isOpen,
  onClose,
  challenge,
  evaluation,
  provider,
  model,
  responseTimeMs,
  targetLanguage = "English",
  nativeLanguage = "Vietnamese",
  existingReport,
  onReportSaved,
  onReportDeleted,
  showToast,
}: ReportPoorSentenceModalProps) {
  useModalBackNavigation(isOpen, onClose);

  const [selectedReason, setSelectedReason] = useState<string>("unnatural_phrasing");
  const [notes, setNotes] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (existingReport) {
        setSelectedReason(existingReport.reason || "unnatural_phrasing");
        setNotes(existingReport.notes || "");
      } else {
        setSelectedReason("unnatural_phrasing");
        setNotes("");
      }
    }
  }, [isOpen, existingReport]);

  if (!isOpen || typeof document === "undefined") return null;

  const effectiveNativeSentence = challenge?.nativeSentence || "";
  const effectiveTargetLang = challenge?.targetLanguage || targetLanguage;
  const effectiveNativeLang = challenge?.nativeLanguage || nativeLanguage;
  const effectiveProvider = provider || challenge?.provider || evaluation?.provider || "AI Engine";
  const effectiveModel = model || challenge?.model || evaluation?.model || "default";
  const effectiveResponseTimeMs = responseTimeMs ?? challenge?.responseTimeMs ?? evaluation?.responseTimeMs;
  const idealTranslation = evaluation?.correctedSentence || challenge?.idealTranslation || "";
  const targetWord = challenge?.targetWordFromCollection?.word || evaluation?.targetWordUsed || "";

  const handleSave = async () => {
    if (!effectiveNativeSentence.trim()) {
      showToast?.("No sentence to report.");
      onClose();
      return;
    }

    setIsSaving(true);
    try {
      const reasonObj = COMMON_REASONS.find(r => r.id === selectedReason);
      const report: PoorSentenceReport = {
        id: existingReport?.id || `poor_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: existingReport?.timestamp || new Date().toISOString(),
        challengeId: challenge?.id,
        nativeSentence: effectiveNativeSentence.trim(),
        targetLanguage: effectiveTargetLang,
        nativeLanguage: effectiveNativeLang,
        topicContext: challenge?.topicContext,
        targetWord: targetWord || undefined,
        keyTargetWords: challenge?.keyTargetWords,
        idealTranslation: idealTranslation.trim() || undefined,
        userTranslation: evaluation?.userTranslation?.trim() || undefined,
        evaluationScore: evaluation?.score,
        evaluationFeedback: evaluation ? `${evaluation.whatWentWell ? `Well: ${evaluation.whatWentWell}. ` : ""}${evaluation.areasForImprovement ? `Improve: ${evaluation.areasForImprovement}` : ""}`.trim() : undefined,
        provider: effectiveProvider,
        model: effectiveModel,
        responseTimeMs: effectiveResponseTimeMs,
        reason: reasonObj?.label || selectedReason,
        notes: notes.trim() || undefined,
        phase: evaluation ? "evaluation" : "prompt",
      };

      await savePoorSentenceReportToDB(report);
      onReportSaved?.(report);
      showToast?.("Saved to Poor Sentences dataset!");
      onClose();
    } catch (err: any) {
      console.error("Failed to save poor sentence report:", err);
      showToast?.("Failed to save report.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!existingReport?.id) return;
    setIsSaving(true);
    try {
      await deletePoorSentenceReportFromDB(existingReport.id);
      onReportDeleted?.(existingReport.id);
      showToast?.("Removed from poor sentences collection.");
      onClose();
    } catch (err) {
      console.error("Failed to delete report:", err);
      showToast?.("Failed to delete report.");
    } finally {
      setIsSaving(false);
    }
  };

  return createPortal(
    <AnimatePresence>
      <div 
        className="fixed inset-0 z-[99999] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          onClick={(e) => e.stopPropagation()}
          className="w-full sm:max-w-md bg-white border-t sm:border border-stone-200 rounded-t-3xl sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] bottom-0"
        >
          {/* Header */}
          <div className="px-4 py-3 sm:px-5 sm:py-3.5 border-b border-stone-100 flex items-center justify-between gap-3 bg-stone-50/80 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <span className="p-1.5 bg-amber-500 text-white rounded-lg shadow-2xs shrink-0">
                <Flag className="w-4 h-4 fill-white" />
              </span>
              <div className="min-w-0">
                <h3 className="font-bold text-sm text-stone-900 leading-tight truncate">
                  {existingReport ? "Edit Flagged Sentence" : "Flag Poor Sentence"}
                </h3>
                <span className="text-[11px] text-stone-500 font-medium block truncate">
                  Save to dataset for LLM improvement
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 rounded-lg transition-colors cursor-pointer shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Scrollable Content */}
          <div className="p-4 sm:p-5 overflow-y-auto space-y-3.5 text-xs">
            {/* Compact Sentence Reference */}
            <div className="p-3 bg-amber-50/80 border border-amber-200/80 rounded-xl space-y-1.5">
              <div className="flex items-center justify-between gap-1 text-[10px] font-mono text-amber-900/80 font-bold uppercase tracking-wider">
                <span>{effectiveNativeLang} sentence</span>
                {challenge?.topicContext && (
                  <span className="px-1.5 py-0.2 bg-amber-200/70 text-amber-950 rounded font-sans font-medium lowercase">
                    {challenge.topicContext}
                  </span>
                )}
              </div>
              <p className="text-xs sm:text-sm font-bold text-stone-900 leading-snug">
                "{effectiveNativeSentence}"
              </p>
              <div className="flex items-center justify-between gap-2 text-[10.5px] text-stone-500 font-mono pt-0.5">
                <span>Model: <strong className="text-stone-700">{effectiveModel}</strong></span>
                {targetWord && <span>Target: <strong className="text-stone-700">{targetWord}</strong></span>}
              </div>
            </div>

            {/* Compact Reason Selection Pills */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold text-stone-700 uppercase tracking-wider font-mono">
                Select main issue:
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                {COMMON_REASONS.map((reason) => {
                  const isSelected = selectedReason === reason.id || selectedReason === reason.label;
                  return (
                    <button
                      key={reason.id}
                      type="button"
                      onClick={() => setSelectedReason(reason.id)}
                      className={`px-2.5 py-2 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between text-xs font-semibold ${
                        isSelected
                          ? "bg-stone-900 text-amber-400 border-stone-900 shadow-2xs"
                          : "bg-stone-50 hover:bg-stone-100 text-stone-700 border-stone-200"
                      }`}
                    >
                      <span className="truncate">{reason.label}</span>
                      {isSelected && <Check className="w-3 h-3 text-amber-400 stroke-[3] shrink-0 ml-1" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Note / Suggested correction */}
            <div className="space-y-1">
              <label htmlFor="poor-sentence-notes" className="block text-[11px] font-bold text-stone-700">
                Correction or notes <span className="font-normal text-stone-400">(optional)</span>:
              </label>
              <textarea
                id="poor-sentence-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What should it say, or what is wrong with this phrasing?"
                rows={2}
                className="w-full p-2.5 bg-stone-50 border border-stone-200 focus:border-stone-400 focus:bg-white rounded-xl text-stone-900 placeholder:text-stone-400 text-xs focus:outline-none transition-all leading-relaxed resize-none"
              />
            </div>
          </div>

          {/* Fixed Bottom Action Bar */}
          <div className="p-3 sm:p-4 border-t border-stone-100 bg-stone-50/90 flex items-center justify-between gap-2 shrink-0 pb-safe">
            {existingReport ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isSaving}
                className="px-3 py-2 text-rose-700 hover:text-rose-800 hover:bg-rose-50 border border-rose-200 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Unflag</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="px-3 py-2 text-stone-500 hover:text-stone-800 rounded-xl font-medium text-xs transition-colors cursor-pointer"
              >
                Cancel
              </button>
            )}

            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="flex-1 sm:flex-initial px-4 py-2 bg-stone-900 hover:bg-black active:scale-98 text-amber-400 font-bold text-xs rounded-xl transition-all cursor-pointer shadow-2xs flex items-center justify-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>{isSaving ? "Saving..." : existingReport ? "Update" : "Save to Dataset"}</span>
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}
