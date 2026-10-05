import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import {
  Flag,
  X,
  Search,
  Trash2,
  Copy,
  Check,
  Bot,
  AlertTriangle,
  FileJson,
  FileSpreadsheet,
  Filter,
  RefreshCw,
  MessageSquare
} from "lucide-react";
import { PoorSentenceReport } from "../../types";
import { useModalBackNavigation } from "../../hooks/useModalBackNavigation";
import {
  getPoorSentenceReportsFromDB,
  deletePoorSentenceReportFromDB,
  clearAllPoorSentenceReportsFromDB
} from "../../db/indexedDB";

interface PoorSentencesModalProps {
  isOpen: boolean;
  onClose: () => void;
  showToast?: (msg: string) => void;
}

export default function PoorSentencesModal({
  isOpen,
  onClose,
  showToast,
}: PoorSentencesModalProps) {
  useModalBackNavigation(isOpen, onClose);

  const [reports, setReports] = useState<PoorSentenceReport[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedReasonFilter, setSelectedReasonFilter] = useState<string>("all");
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<string>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const loadReports = async () => {
    setIsLoading(true);
    try {
      const data = await getPoorSentenceReportsFromDB();
      setReports(data);
    } catch (err) {
      console.error("Failed to load poor sentence reports:", err);
      showToast?.("Failed to load reported sentences.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadReports();
    }
  }, [isOpen]);

  useEffect(() => {
    const handleUpdate = () => {
      if (isOpen) loadReports();
    };
    window.addEventListener("vocab-poor-sentences-updated", handleUpdate);
    return () => window.removeEventListener("vocab-poor-sentences-updated", handleUpdate);
  }, [isOpen]);

  const uniqueReasons = useMemo(() => {
    const set = new Set<string>();
    reports.forEach((r) => {
      if (r.reason) set.add(r.reason);
    });
    return Array.from(set);
  }, [reports]);

  const uniqueProviders = useMemo(() => {
    const set = new Set<string>();
    reports.forEach((r) => {
      if (r.provider) set.add(r.provider);
    });
    return Array.from(set);
  }, [reports]);

  const filteredReports = useMemo(() => {
    return reports.filter((r) => {
      // Reason filter
      if (selectedReasonFilter !== "all" && r.reason !== selectedReasonFilter) {
        return false;
      }
      // Provider filter
      if (selectedProviderFilter !== "all" && r.provider !== selectedProviderFilter) {
        return false;
      }
      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const sentenceMatch = r.nativeSentence.toLowerCase().includes(q);
        const transMatch = r.idealTranslation?.toLowerCase().includes(q) || false;
        const userMatch = r.userTranslation?.toLowerCase().includes(q) || false;
        const notesMatch = r.notes?.toLowerCase().includes(q) || false;
        const modelMatch = r.model?.toLowerCase().includes(q) || false;
        const reasonMatch = r.reason?.toLowerCase().includes(q) || false;
        const targetWordMatch = r.targetWord?.toLowerCase().includes(q) || false;
        return sentenceMatch || transMatch || userMatch || notesMatch || modelMatch || reasonMatch || targetWordMatch;
      }
      return true;
    });
  }, [reports, selectedReasonFilter, selectedProviderFilter, searchQuery]);

  const handleDeleteOne = async (id: string) => {
    try {
      await deletePoorSentenceReportFromDB(id);
      setReports((prev) => prev.filter((item) => item.id !== id));
      showToast?.("Sentence report removed.");
    } catch (err) {
      showToast?.("Failed to delete report.");
    }
  };

  const handleClearAll = async () => {
    try {
      await clearAllPoorSentenceReportsFromDB();
      setReports([]);
      setShowClearConfirm(false);
      showToast?.("All poor sentence reports cleared.");
    } catch (err) {
      showToast?.("Failed to clear reports.");
    }
  };

  const handleCopyPair = (report: PoorSentenceReport) => {
    const exportObject = {
      challenge_sentence: report.nativeSentence,
      native_language: report.nativeLanguage,
      target_language: report.targetLanguage,
      target_word: report.targetWord || undefined,
      ideal_translation: report.idealTranslation || undefined,
      issue_detected: report.reason,
      user_feedback_notes: report.notes || undefined,
      generator_model: report.model,
      generator_provider: report.provider,
      reported_at: report.timestamp
    };

    navigator.clipboard.writeText(JSON.stringify(exportObject, null, 2));
    setCopiedId(report.id);
    showToast?.("Copied prompt tuning pair to clipboard!");
    setTimeout(() => setCopiedId(null), 2500);
  };

  const handleExportJSON = () => {
    if (reports.length === 0) {
      showToast?.("No sentences to export.");
      return;
    }
    const dataToExport = {
      exportedAt: new Date().toISOString(),
      datasetName: "translation_challenge_poor_sentences_llm_enhancement",
      totalCount: reports.length,
      sentences: reports.map((r) => ({
        id: r.id,
        timestamp: r.timestamp,
        nativeSentence: r.nativeSentence,
        nativeLanguage: r.nativeLanguage,
        targetLanguage: r.targetLanguage,
        topicContext: r.topicContext,
        targetWord: r.targetWord,
        idealTranslation: r.idealTranslation,
        userTranslation: r.userTranslation,
        score: r.evaluationScore,
        reason: r.reason,
        notes: r.notes,
        provider: r.provider,
        model: r.model,
        responseTimeMs: r.responseTimeMs
      }))
    };

    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vocab-poor-sentences-dataset-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast?.(`Exported ${reports.length} poor sentence records to JSON.`);
  };

  const handleExportCSV = () => {
    if (reports.length === 0) {
      showToast?.("No sentences to export.");
      return;
    }

    const headers = [
      "ID",
      "Timestamp",
      "Native Sentence",
      "Native Language",
      "Target Language",
      "Topic Context",
      "Target Word",
      "Ideal Translation",
      "User Translation",
      "Score",
      "Issue Reason",
      "Notes",
      "Provider",
      "Model"
    ];

    const escapeCsv = (val?: string | number | null) => {
      if (val === undefined || val === null) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = reports.map((r) => [
      escapeCsv(r.id),
      escapeCsv(r.timestamp),
      escapeCsv(r.nativeSentence),
      escapeCsv(r.nativeLanguage),
      escapeCsv(r.targetLanguage),
      escapeCsv(r.topicContext),
      escapeCsv(r.targetWord),
      escapeCsv(r.idealTranslation),
      escapeCsv(r.userTranslation),
      escapeCsv(r.evaluationScore),
      escapeCsv(r.reason),
      escapeCsv(r.notes),
      escapeCsv(r.provider),
      escapeCsv(r.model)
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((row) => row.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vocab-poor-sentences-dataset-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast?.(`Exported ${reports.length} poor sentence records to CSV.`);
  };

  if (!isOpen || typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      <div 
        className="fixed inset-0 z-[99999] flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-4xl bg-white border border-stone-200/90 rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[90vh] max-h-[850px]"
        >
          {/* Header */}
          <div className="p-4 sm:p-5 border-b border-stone-100 flex items-center justify-between gap-3 bg-stone-50/80">
            <div className="flex items-center gap-3 min-w-0">
              <div className="p-2.5 bg-amber-500 text-white rounded-xl shadow-2xs shrink-0">
                <Flag className="w-5 h-5 fill-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-base sm:text-lg text-stone-900 leading-tight">
                    Reported Poor Sentences Dataset
                  </h3>
                  <span className="px-2.5 py-0.5 bg-amber-100 border border-amber-300 text-amber-900 font-bold text-xs rounded-full">
                    {reports.length} {reports.length === 1 ? "sentence" : "sentences"}
                  </span>
                </div>
                <p className="text-xs text-stone-500 font-medium truncate mt-0.5">
                  Stored flawed challenge sentences to improve LLM prompts, few-shot examples, & fine-tuning
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Action Toolbar & Filters */}
          <div className="p-3 sm:p-4 border-b border-stone-100 bg-white space-y-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
              {/* Search input */}
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by sentence, issue, translation, note, or model..."
                  className="w-full pl-9 pr-8 py-2 bg-stone-50 border border-stone-200/90 rounded-xl text-xs font-medium text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-stone-400 focus:bg-white transition-all"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700 p-0.5"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Export Buttons */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleExportJSON}
                  disabled={reports.length === 0}
                  className="px-3 py-2 bg-stone-900 hover:bg-black text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-2xs disabled:opacity-40"
                  title="Export complete dataset as JSON format for LLM training/evaluation"
                >
                  <FileJson className="w-3.5 h-3.5 text-amber-400" />
                  <span>Export JSON</span>
                </button>

                <button
                  type="button"
                  onClick={handleExportCSV}
                  disabled={reports.length === 0}
                  className="px-3 py-2 bg-stone-100 hover:bg-stone-200 border border-stone-300 text-stone-800 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-40"
                  title="Export dataset as CSV table for spreadsheet review"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Export CSV</span>
                </button>

                {reports.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowClearConfirm(true)}
                    className="p-2 text-stone-400 hover:text-rose-600 hover:bg-rose-50 border border-stone-200 hover:border-rose-300 rounded-xl transition-all cursor-pointer"
                    title="Clear all collected poor sentences"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 font-mono flex items-center gap-1 shrink-0">
                <Filter className="w-3 h-3" /> Filter:
              </span>

              <button
                type="button"
                onClick={() => setSelectedReasonFilter("all")}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all shrink-0 cursor-pointer ${
                  selectedReasonFilter === "all"
                    ? "bg-stone-900 text-amber-400 shadow-2xs"
                    : "bg-stone-100 hover:bg-stone-200 text-stone-600"
                }`}
              >
                All Issues ({reports.length})
              </button>

              {uniqueReasons.map((reason) => {
                const count = reports.filter((r) => r.reason === reason).length;
                return (
                  <button
                    key={reason}
                    type="button"
                    onClick={() => setSelectedReasonFilter(reason)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all shrink-0 cursor-pointer ${
                      selectedReasonFilter === reason
                        ? "bg-stone-900 text-amber-400 shadow-2xs"
                        : "bg-stone-100 hover:bg-stone-200 text-stone-600"
                    }`}
                  >
                    {reason} ({count})
                  </button>
                );
              })}

              {uniqueProviders.length > 1 && (
                <div className="pl-2 border-l border-stone-200 flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] font-mono text-stone-400">Provider:</span>
                  <select
                    value={selectedProviderFilter}
                    onChange={(e) => setSelectedProviderFilter(e.target.value)}
                    className="p-1 text-[11px] bg-stone-100 border border-stone-300 rounded-lg text-stone-800 font-medium"
                  >
                    <option value="all">All Providers</option>
                    {uniqueProviders.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* Body Content List */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-3 bg-stone-50/50">
            {isLoading ? (
              <div className="py-12 flex flex-col items-center justify-center text-stone-400 space-y-2">
                <RefreshCw className="w-6 h-6 animate-spin text-stone-600" />
                <span className="text-xs font-medium">Loading poor sentences dataset...</span>
              </div>
            ) : filteredReports.length === 0 ? (
              <div className="py-16 text-center space-y-3 bg-white border border-stone-200/80 rounded-2xl p-8">
                <div className="w-12 h-12 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mx-auto border border-amber-200">
                  <Flag className="w-6 h-6" />
                </div>
                <div>
                  <h4 className="font-bold text-stone-900 text-sm sm:text-base">
                    {reports.length === 0
                      ? "No Poor Sentences Reported Yet"
                      : "No Sentences Match Your Search Filter"}
                  </h4>
                  <p className="text-xs text-stone-500 max-w-md mx-auto mt-1">
                    {reports.length === 0
                      ? "When you practice a Translation Challenge, tap the flag button on any poorly phrased or erroneous sentence to collect it here for LLM prompt enhancement!"
                      : "Try adjusting your search query or reset the filter to view all collected sentences."}
                  </p>
                </div>
              </div>
            ) : (
              filteredReports.map((report) => {
                const isCopied = copiedId === report.id;
                const formattedDate = new Date(report.timestamp).toLocaleString();

                return (
                  <div
                    key={report.id}
                    className="p-4 bg-white border border-stone-200/90 rounded-2xl shadow-xs space-y-3 hover:border-stone-300 transition-all"
                  >
                    {/* Top Row: Date, Badges, and Action Buttons */}
                    <div className="flex items-center justify-between gap-2 flex-wrap pb-2 border-b border-stone-100">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-bold rounded-lg flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-rose-600" />
                          <span>{report.reason || "Quality Issue"}</span>
                        </span>

                        <span className="px-2 py-0.5 bg-stone-100 border border-stone-200 text-stone-700 text-[11px] font-mono font-medium rounded-lg flex items-center gap-1">
                          <Bot className="w-3 h-3 text-stone-500" />
                          <span>{report.provider} ({report.model})</span>
                        </span>

                        {report.topicContext && (
                          <span className="px-2 py-0.5 bg-amber-50 border border-amber-200/80 text-amber-900 text-[11px] font-medium rounded-lg">
                            {report.topicContext}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="text-[10px] text-stone-400 font-mono mr-1 hidden sm:inline">
                          {formattedDate}
                        </span>

                        <button
                          type="button"
                          onClick={() => handleCopyPair(report)}
                          className="px-2.5 py-1 bg-stone-100 hover:bg-stone-200 text-stone-800 text-xs font-semibold rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                          title="Copy JSON pair formatted for few-shot prompt training"
                        >
                          {isCopied ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-600 stroke-[3]" />
                              <span className="text-emerald-700 font-bold">Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3 text-stone-500" />
                              <span>Copy Pair</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteOne(report.id)}
                          className="p-1 text-stone-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                          title="Delete this report"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Sentence Content */}
                    <div className="space-y-2">
                      <div>
                        <span className="text-[10px] uppercase font-bold tracking-wider font-mono text-stone-400 block mb-0.5">
                          Generated Challenge Sentence ({report.nativeLanguage}):
                        </span>
                        <p className="text-sm sm:text-base font-bold text-stone-900 leading-snug break-words">
                          "{report.nativeSentence}"
                        </p>
                      </div>

                      {/* Ideal translation if present */}
                      {report.idealTranslation && (
                        <div className="p-2.5 bg-emerald-50/70 border border-emerald-200/60 rounded-xl space-y-0.5">
                          <span className="text-[10px] uppercase font-bold tracking-wider font-mono text-emerald-800 block">
                            Ideal Target Translation ({report.targetLanguage}):
                          </span>
                          <p className="text-xs sm:text-sm font-semibold text-emerald-950 break-words">
                            "{report.idealTranslation}"
                          </p>
                        </div>
                      )}

                      {/* User submission & score if present */}
                      {report.userTranslation && (
                        <div className="p-2.5 bg-stone-50 border border-stone-200/70 rounded-xl flex items-center justify-between gap-2 flex-wrap">
                          <div className="min-w-0 flex-1">
                            <span className="text-[10px] uppercase font-bold tracking-wider font-mono text-stone-500 block">
                              User Submission:
                            </span>
                            <p className="text-xs text-stone-800 font-medium break-words">
                              "{report.userTranslation}"
                            </p>
                          </div>
                          {typeof report.evaluationScore === "number" && (
                            <span className="px-2 py-0.5 bg-stone-200 font-mono text-stone-800 text-[11px] font-bold rounded-md shrink-0">
                              Score: {report.evaluationScore}/100
                            </span>
                          )}
                        </div>
                      )}

                      {/* Target word */}
                      {report.targetWord && (
                        <div className="text-xs text-stone-600">
                          <span className="font-semibold text-stone-500">Target Word from Collection: </span>
                          <strong className="font-mono text-stone-900">{report.targetWord}</strong>
                        </div>
                      )}

                      {/* User Notes / Suggested Correction */}
                      {report.notes && (
                        <div className="p-2.5 bg-amber-50/80 border border-amber-200/80 rounded-xl space-y-0.5 text-xs text-amber-950">
                          <div className="flex items-center gap-1 font-bold text-[11px] text-amber-900 uppercase tracking-wider font-mono">
                            <MessageSquare className="w-3 h-3 text-amber-700" />
                            <span>User Notes & Suggested Correction:</span>
                          </div>
                          <p className="leading-relaxed whitespace-pre-wrap font-medium">
                            {report.notes}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="p-3.5 sm:p-4 border-t border-stone-100 flex items-center justify-between gap-3 bg-stone-50/80 text-xs text-stone-500">
            <span className="font-medium">
              Showing {filteredReports.length} of {reports.length} recorded items
            </span>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-stone-900 hover:bg-black text-white font-bold rounded-xl transition-all cursor-pointer shadow-2xs"
            >
              Close
            </button>
          </div>
        </motion.div>
      </div>

      {/* Clear All Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-stone-900/70 backdrop-blur-xs">
          <div className="bg-white border border-stone-200 p-6 rounded-2xl max-w-sm w-full space-y-4 shadow-2xl">
            <div className="flex items-center gap-2 text-rose-600 font-bold text-sm">
              <AlertTriangle className="w-5 h-5" />
              <span>Clear All Collected Sentences?</span>
            </div>
            <p className="text-xs text-stone-600 leading-relaxed">
              This will permanently delete all {reports.length} reported poor sentence records from your IndexedDB database.
            </p>
            <div className="flex gap-2 justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowClearConfirm(false)}
                className="px-3 py-1.5 text-xs font-semibold text-stone-600 hover:text-stone-900 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg cursor-pointer transition-all shadow-xs"
              >
                Yes, Clear All
              </button>
            </div>
          </div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
}
