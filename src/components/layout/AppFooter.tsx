import React from "react";
import { APP_VERSION } from "../../config/appVersion";

export default function AppFooter() {
  return (
    <footer className="bg-white border-t border-stone-200 py-6 px-6 text-center text-stone-400 text-xs">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-3">
        <p>© 2026 Vocabulary Learner. Designed with extreme typographic precision and absolute utility.</p>
        <div className="flex gap-4 items-center font-semibold text-stone-500 text-xs">
          <span>Powered by Gemini AI</span>
          <span className="font-mono text-[11px] bg-stone-100 border border-stone-200 px-2 py-0.5 text-stone-700">v{APP_VERSION}</span>
        </div>
      </div>
    </footer>
  );
}
