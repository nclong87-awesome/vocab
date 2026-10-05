import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  X, 
  Check, 
  Trash2, 
  Bot, 
  Languages, 
  Info,
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
  { id: "unnatural_phrasing", label: "Unnatural Phrasing", desc: "Awkward or robotic native sentence" },
  { id: "incorrect_translation", label: "Incorrect Translation", desc: "Target translation has semantic or meaning errors" },
  { id: "grammar_error", label: "Grammar / Syntax Error", desc: "Grammatical or syntactic structural flaws" },
  { id: "target_word_mismatch", label: "Target Word Mismatch", desc: "Target word doesn't fit or is forced into context" },
  { id: "poor_topic_context", label: "Awkward Context", desc: "Unrealistic or bizarre scenario for real communication" },
  { id: "other", label: "Other Quality Issue", desc: "Other issues affecting LLM generation quality" },
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

  if (!isOpen) return null;

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
      showToast?.("Sentence collected for LLM enhancement dataset!");
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
      showToast?.("Report removed from poor sentences collection.");
      onClose();
    } catch (err) {
      console.error("Failed to delete report:", err);
      showToast?.("Failed to delete report.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AnimatePresence>
      <div 
        className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-stone-900/60 backdrop-blur-xs"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-lg bg-white border border-stone-200/90 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-stone-100 flex items-center justify-between gap-3 bg-stone-50/70">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-amber-500 text-white rounded-xl shadow-2xs">
                <Flag className="w-4 h-4 fill-white" />
              </div>
              <div>
                <h3 className="font-bold text-sm sm:text-base text-stone-900 leading-tight">
                  {existingReport ? "Edit Poor Sentence Report" : "Report Poorly Generated Sentence"}
                </h3>
                <p className="text-[11px] sm:text-xs text-stone-500 font-medium">
                  Collect flawed outputs to improve LLM generation prompts & fine-tuning
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body Content */}
          <div className="p-4 sm:p-5 overflow-y-auto space-y-4 text-xs">
            {/* Sentence Preview Card */}
            <div className="p-3.5 bg-amber-50/70 border border-amber-200/80 rounded-xl space-y-2">
              <div className="flex items-center justify-between gap-2 flex-wrap text-[10px] font-mono font-bold uppercase tracking-wider text-amber-900">
                <span className="flex items-center gap-1">
                  <Languages className="w-3.5 h-3.5 text-amber-700" />
                  Generated Sentence ({effectiveNativeLang}):
                </span>
                {challenge?.topicContext && (
                  <span className="px-2 py-0.5 bg-amber-200/80 text-amber-950 rounded-full font-sans font-medium lowercase">
                    {challenge.topicContext}
                  </span>
                )}
              </div>
              <p className="text-sm sm:text-base font-bold text-stone-900 leading-snug break-words">
                "{effectiveNativeSentence}"
              </p>

              {/* Target Word and/or Ideal Translation if available */}
              {(targetWord || idealTranslation) && (
                <div className="pt-2 border-t border-amber-200/60 space-y-1 text-xs">
                  {targetWord && (
                    <div className="text-amber-900">
                      <span className="font-semibold text-stone-600">Target Word: </span>
                      <span className="font-bold font-mono text-stone-900">{targetWord}</span>
                    </div>
                  )}
                  {idealTranslation && (
                    <div className="text-amber-900">
                      <span className="font-semibold text-stone-600">Ideal Translation ({effectiveTargetLang}): </span>
                      <span className="font-medium text-stone-900 italic">"{idealTranslation}"</span>
                    </div>
                  )}
                </div>
              )}

              {/* LLM Engine metadata tag */}
              <div className="flex items-center gap-2 pt-1 text-[11px] text-stone-500 font-mono">
                <Bot className="w-3 h-3 text-stone-400" />
                <span>Generated by: <strong className="text-stone-700">{effectiveProvider}</strong> ({effectiveModel})</span>
              </div>
            </div>

            {/* Issue Category Selection */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-stone-800 uppercase tracking-wider font-mono">
                What is the issue with this sentence?
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {COMMON_REASONS.map((reason) => {
                  const isSelected = selectedReason === reason.id || selectedReason === reason.label;
                  return (
                    <button
                      key={reason.id}
                      type="button"
                      onClick={() => setSelectedReason(reason.id)}
                      className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-1 ${
                        isSelected
                          ? "bg-stone-900 text-white border-stone-900 shadow-2xs"
                          : "bg-stone-50 hover:bg-stone-100 text-stone-800 border-stone-200/90"
                      }`}
                    >
                      <div className="flex items-center justify-between w-full">
                        <span className="font-bold text-xs">{reason.label}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-amber-400 stroke-[3]" />}
                      </div>
                      <span className={`text-[10.5px] leading-tight ${isSelected ? "text-stone-300" : "text-stone-500"}`}>
                        {reason.desc}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* User Note / Suggested Correction Textarea */}
            <div className="space-y-1.5">
              <label htmlFor="poor-sentence-notes" className="block text-xs font-bold text-stone-800">
                Suggested correction or notes <span className="font-normal text-stone-400">(optional)</span>:
              </label>
              <textarea
                id="poor-sentence-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. In Vietnamese, native speakers would say '...', or the vocabulary word is misused in this context..."
                rows={3}
                className="w-full p-3 bg-stone-50 border border-stone-200/90 focus:border-stone-400 focus:bg-white rounded-xl text-stone-900 placeholder:text-stone-400 text-xs focus:outline-none transition-all leading-relaxed"
              />
            </div>

            {/* Helper explanation */}
            <div className="p-3 bg-stone-100/70 border border-stone-200/60 rounded-xl flex items-start gap-2 text-stone-600 text-[11px] leading-relaxed">
              <Info className="w-3.5 h-3.5 text-stone-500 shrink-0 mt-0.5" />
              <span>
                All reported sentences are stored in your local database and can be reviewed, edited, or exported as JSON/CSV in Settings to train and improve LLM system prompts.
              </span>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="p-4 sm:p-5 border-t border-stone-100 flex items-center justify-between gap-2.5 bg-stone-50/50">
            {existingReport ? (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isSaving}
                className="px-3.5 py-2 text-rose-700 hover:text-rose-800 hover:bg-rose-50 border border-rose-200 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                title="Remove this sentence from poor sentences collection"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Remove Flag</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="px-3.5 py-2 text-stone-600 hover:text-stone-900 hover:bg-stone-100 rounded-xl font-semibold text-xs transition-all cursor-pointer"
              >
                Cancel
              </button>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-2 bg-stone-900 hover:bg-black active:scale-98 text-amber-400 font-bold text-xs sm:text-sm rounded-xl transition-all cursor-pointer shadow-2xs flex items-center gap-1.5 disabled:opacity-50"
              >
                {isSaving ? (
                  <span>Saving...</span>
                ) : (
                  <>
                    <Flag className="w-3.5 h-3.5 fill-current" />
                    <span>{existingReport ? "Update Report" : "Save to Collection"}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
