import React from "react";

export default function AppFooter() {
  return (
    <footer className="bg-white border-t border-stone-200 py-6 px-6 text-center text-stone-400 text-xs">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-3">
        <p>© 2026 Vocabulary Learner. Designed with extreme typographic precision and absolute utility.</p>
        <div className="flex gap-4 font-semibold text-stone-500 text-xs">
          <span>Powered by Gemini AI</span>
        </div>
      </div>
    </footer>
  );
}
