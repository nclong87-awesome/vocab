import { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Mail, Copy, Check, Trash2, Bug, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  isDetailsExpanded: boolean;
  copied: boolean;
  reportSent: boolean;
  sendingReport: boolean;
  customNote: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    isDetailsExpanded: false,
    copied: false,
    reportSent: false,
    sendingReport: false,
    customNote: "",
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught React Error caught by ErrorBoundary:", error, errorInfo);
    this.setState({ errorInfo });

    // Automatically send error log to backend /api/report-error
    this.sendReportToServer(error, errorInfo);
  }

  componentDidMount() {
    window.addEventListener("unhandledrejection", this.handleUnhandledRejection);
    window.addEventListener("error", this.handleGlobalError);
  }

  componentWillUnmount() {
    window.removeEventListener("unhandledrejection", this.handleUnhandledRejection);
    window.removeEventListener("error", this.handleGlobalError);
  }

  private handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    console.error("Unhandled Promise Rejection:", event.reason);
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason || "Unhandled Promise Rejection"));
    if (!this.state.hasError) {
      this.setState({
        hasError: true,
        error,
        errorInfo: { componentStack: "\n    at UnhandledPromiseRejection (async)" },
      });
      this.sendReportToServer(error, null);
    }
  };

  private handleGlobalError = (event: ErrorEvent) => {
    console.error("Global Error caught:", event.error || event.message);
    const error = event.error instanceof Error ? event.error : new Error(event.message || "Global Runtime Error");
    if (!this.state.hasError) {
      this.setState({
        hasError: true,
        error,
        errorInfo: { componentStack: `\n    at ${event.filename}:${event.lineno}:${event.colno}` },
      });
      this.sendReportToServer(error, null);
    }
  };

  private sendReportToServer = async (error: Error, errorInfo: ErrorInfo | null) => {
    try {
      this.setState({ sendingReport: true });
      await fetch("/api/report-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipientEmail: "nclong87@gmail.com",
          error: error.message || String(error),
          stack: error.stack || "",
          componentStack: errorInfo?.componentStack || "",
          userAgent: navigator.userAgent,
          url: window.location.href,
          timestamp: new Date().toISOString(),
        }),
      });
      this.setState({ reportSent: true });
    } catch (err) {
      console.warn("Failed to auto-report error to server:", err);
    } finally {
      this.setState({ sendingReport: false });
    }
  };

  private getFormattedReportText = (): string => {
    const { error, errorInfo, customNote } = this.state;
    const timeStr = new Date().toLocaleString();
    const userAgent = navigator.userAgent;
    const url = window.location.href;

    return `VOCAB LEARNER APPLICATION ERROR REPORT
==================================================
Target Recipient: nclong87@gmail.com
Timestamp: ${timeStr}
App URL: ${url}
User Agent: ${userAgent}
${customNote ? `\nUser Additional Context: ${customNote}\n` : ""}
ERROR DETAILS:
Name: ${error?.name || "Error"}
Message: ${error?.message || "Unknown error occurred"}

ERROR STACK:
${error?.stack || "No stack trace available"}

COMPONENT STACK:
${errorInfo?.componentStack || "No component stack available"}
==================================================`;
  };

  private handleSendEmailReport = () => {
    const { error, errorInfo } = this.state;
    const recipient = "nclong87@gmail.com";
    const subject = encodeURIComponent(`[Vocab Learner App Crash Report] ${error?.message || "Runtime Error"}`);
    
    const bodyText = this.getFormattedReportText();
    const mailtoUrl = `mailto:${recipient}?subject=${subject}&body=${encodeURIComponent(bodyText)}`;

    // Attempt to open default mail client
    window.location.href = mailtoUrl;

    // Also trigger server endpoint if not sent yet
    if (error) {
      this.sendReportToServer(error, errorInfo);
    }

    this.setState({ reportSent: true });
  };

  private handleCopyError = () => {
    const reportText = this.getFormattedReportText();
    navigator.clipboard.writeText(reportText);
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 3000);
  };

  private handleResetDataAndReload = () => {
    if (window.confirm("Are you sure you want to reset all local app state and reload? This clears cached local memory to resolve corrupted state.")) {
      try {
        localStorage.clear();
        sessionStorage.clear();
        indexedDB.databases().then((dbs) => {
          dbs.forEach((db) => {
            if (db.name) indexedDB.deleteDatabase(db.name);
          });
        }).catch((e) => console.error("Error clearing IndexedDB:", e));
      } catch (e) {
        console.error("Error clearing local storage:", e);
      }
      window.location.reload();
    }
  };

  public render() {
    if (this.state.hasError) {
      const { error, errorInfo, isDetailsExpanded, copied, reportSent, sendingReport, customNote } = this.state;

      return (
        <div className="min-h-screen w-full bg-stone-900 text-stone-100 flex items-center justify-center p-4 sm:p-6 font-sans">
          <div className="max-w-2xl w-full bg-stone-800 border border-stone-700/80 rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
            
            {/* Header / Error Icon */}
            <div className="flex items-start gap-4 border-b border-stone-700/70 pb-6">
              <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center shrink-0 text-red-400">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div className="space-y-1 min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold font-mono uppercase bg-red-500/20 text-red-300 px-2 py-0.5 rounded border border-red-500/30">
                    Application Crash Captured
                  </span>
                  {reportSent && (
                    <span className="text-xs font-bold font-mono uppercase bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded border border-emerald-500/30 flex items-center gap-1">
                      <Check className="w-3 h-3" /> Report Sent
                    </span>
                  )}
                </div>
                <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  Something Went Wrong
                </h1>
                <p className="text-sm text-stone-400">
                  The application encountered an unexpected runtime exception. An automatic error boundary caught the crash to prevent a blank page.
                </p>
              </div>
            </div>

            {/* Error Summary Banner */}
            <div className="p-4 bg-stone-900/90 border border-red-900/40 rounded-xl space-y-2 font-mono text-xs text-red-300 break-words">
              <div className="flex items-center gap-2 text-stone-400 font-sans font-semibold text-xs">
                <Bug className="w-4 h-4 text-red-400" />
                <span>Error Summary:</span>
              </div>
              <p className="font-bold text-sm text-red-200">
                {error?.name}: {error?.message || "Unknown Application Exception"}
              </p>
            </div>

            {/* User Note Input (Optional Context) */}
            <div className="space-y-1.5">
              <label htmlFor="customNote" className="text-xs font-semibold text-stone-300 flex items-center justify-between">
                <span>What were you doing when the crash occurred? (Optional):</span>
                <span className="text-stone-500 font-normal">Included in email report</span>
              </label>
              <textarea
                id="customNote"
                rows={2}
                value={customNote}
                onChange={(e) => this.setState({ customNote: e.target.value })}
                placeholder="e.g., Pressed 'Common Phrases' in chat or clicked Generate Words..."
                className="w-full bg-stone-900/80 border border-stone-700/80 rounded-xl p-3 text-xs text-stone-200 placeholder:text-stone-500 focus:outline-none focus:border-amber-500/80 transition-colors"
              />
            </div>

            {/* Action Buttons Row */}
            <div className="space-y-3 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Primary Report Button */}
                <button
                  type="button"
                  onClick={this.handleSendEmailReport}
                  disabled={sendingReport}
                  className="w-full py-3 px-4 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold text-sm rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer active:scale-95 disabled:opacity-50"
                  title="Send crash report via email to nclong87@gmail.com"
                >
                  <Mail className="w-4 h-4" />
                  <span>Report Error to nclong87@gmail.com</span>
                  <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                </button>

                {/* Reload Button */}
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="w-full py-3 px-4 bg-stone-700 hover:bg-stone-600 text-white font-semibold text-sm rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-95"
                >
                  <RefreshCw className="w-4 h-4 text-stone-300" />
                  <span>Reload Application</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Copy Error Text Button */}
                <button
                  type="button"
                  onClick={this.handleCopyError}
                  className="w-full py-2.5 px-3 bg-stone-800 hover:bg-stone-750 border border-stone-700 text-stone-300 hover:text-white font-medium text-xs rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400 font-bold">Copied Report to Clipboard!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-stone-400" />
                      <span>Copy Full Diagnostic Report</span>
                    </>
                  )}
                </button>

                {/* Clear Local Data & Reset */}
                <button
                  type="button"
                  onClick={this.handleResetDataAndReload}
                  className="w-full py-2.5 px-3 bg-red-950/40 hover:bg-red-900/60 border border-red-800/50 text-red-300 font-medium text-xs rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  <span>Reset Local Cache & Reload</span>
                </button>
              </div>
            </div>

            {/* Status Indicator */}
            {reportSent && (
              <div className="p-3 bg-emerald-950/40 border border-emerald-800/50 rounded-xl text-xs text-emerald-300 flex items-center gap-2 font-medium">
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>
                  Error report dispatched to server & email composer opened for <strong>nclong87@gmail.com</strong>.
                </span>
              </div>
            )}

            {/* Collapsible Technical Details */}
            <div className="border-t border-stone-700/60 pt-4">
              <button
                type="button"
                onClick={() => this.setState({ isDetailsExpanded: !isDetailsExpanded })}
                className="w-full flex items-center justify-between py-1 text-xs text-stone-400 hover:text-stone-200 transition-colors font-mono cursor-pointer"
              >
                <span>{isDetailsExpanded ? "Hide Technical Call Stack" : "Show Technical Call Stack"}</span>
                {isDetailsExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {isDetailsExpanded && (
                <div className="mt-3 p-4 bg-stone-950 rounded-xl border border-stone-800 overflow-x-auto max-h-64 font-mono text-[11px] text-stone-400 space-y-3 leading-relaxed">
                  <div>
                    <span className="text-amber-400 font-bold block mb-1">Error Stack:</span>
                    <pre className="whitespace-pre-wrap break-words">{error?.stack || "No error stack trace available"}</pre>
                  </div>
                  {errorInfo?.componentStack && (
                    <div className="border-t border-stone-800 pt-2">
                      <span className="text-amber-400 font-bold block mb-1">Component Stack:</span>
                      <pre className="whitespace-pre-wrap break-words">{errorInfo.componentStack}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="text-center pt-2 text-[11px] text-stone-500 font-mono">
              Vocab Learner Error Diagnostic • Support Email: nclong87@gmail.com
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
