import { useState, useRef, useEffect } from "react";
import { Globe, ChevronDown, Check, ArrowRight, Languages, Search, X, Info } from "lucide-react";
import { SUPPORTED_LANGUAGES, getLanguageFlag } from "../../config/languages";
import { useModalBackNavigation } from "../../hooks/useModalBackNavigation";

interface QuickLanguageSwitcherProps {
  targetLanguage: string;
  nativeLanguage: string;
  appLanguage?: string;
  onSelectLanguages: (targetLang: string, nativeLang: string, appLang?: string) => void;
}

export default function QuickLanguageSwitcher({
  targetLanguage,
  nativeLanguage,
  appLanguage,
  onSelectLanguages
}: QuickLanguageSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"target" | "native" | "app">("target");
  const [currentTarget, setCurrentTarget] = useState(targetLanguage);
  const [currentNative, setCurrentNative] = useState(nativeLanguage);
  const [currentApp, setCurrentApp] = useState(appLanguage || nativeLanguage);
  const [searchQuery, setSearchQuery] = useState("");
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);

  useModalBackNavigation(isOpen, () => setIsOpen(false));

  useEffect(() => {
    setCurrentTarget(targetLanguage);
  }, [targetLanguage]);

  useEffect(() => {
    setCurrentNative(nativeLanguage);
  }, [nativeLanguage]);

  useEffect(() => {
    setCurrentApp(appLanguage || nativeLanguage);
  }, [appLanguage, nativeLanguage]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleChooseTarget = (langCode: string) => {
    setCurrentTarget(langCode);
    onSelectLanguages(langCode, currentNative, currentApp);
    setToastMessage(`Target language set to ${langCode}`);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const handleChooseNative = (langCode: string) => {
    setCurrentNative(langCode);
    onSelectLanguages(currentTarget, langCode, currentApp);
    setToastMessage(`Native language set to ${langCode}`);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const handleChooseApp = (langCode: string) => {
    setCurrentApp(langCode);
    onSelectLanguages(currentTarget, currentNative, langCode);
    setToastMessage(`App UI language set to ${langCode}`);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const targetFlag = getLanguageFlag(currentTarget);
  const nativeFlag = getLanguageFlag(currentNative);
  const appFlag = getLanguageFlag(currentApp);

  const filteredLanguages = SUPPORTED_LANGUAGES.filter(lang => 
    lang.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    lang.nativeName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    lang.code.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="relative inline-block text-left shrink-0" ref={dropdownRef} id="quick-lang-switcher">
      
      {/* Header Trigger Button Badge */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1 sm:gap-1.5 px-1.5 py-1 sm:px-2.5 sm:py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer shadow-2xs shrink-0 ${
          isOpen
            ? "bg-stone-900 text-white border-stone-950 ring-2 ring-stone-900/15"
            : "bg-stone-50 hover:bg-stone-100 border-stone-200/90 text-stone-900"
        }`}
        title="Quick Language Switcher (Target & Native Language)"
      >
        <Globe className="w-3.5 h-3.5 text-blue-600 shrink-0" />
        
        <div className="flex items-center gap-0.5 sm:gap-1">
          {/* Mobile view (< sm): flags only */}
          <span className="sm:hidden font-bold flex items-center gap-0.5 text-xs">
            <span>{targetFlag}</span>
            <ArrowRight className="w-2 h-2 opacity-40 shrink-0" />
            <span>{nativeFlag}</span>
          </span>

          {/* Tablet view (sm -> lg): target flag & name -> native flag */}
          <span className="hidden sm:inline lg:hidden font-bold">
            {targetFlag} {currentTarget} <span className="opacity-40">→</span> {nativeFlag}
          </span>

          {/* Desktop view (>= lg): full names */}
          <span className="hidden lg:inline font-bold">{targetFlag} {currentTarget}</span>
          <ArrowRight className="hidden lg:inline w-3 h-3 opacity-40" />
          <span className="hidden lg:inline text-stone-500 font-normal">{nativeFlag} {currentNative}</span>
        </div>

        <ChevronDown className={`w-3.5 h-3.5 opacity-60 transition-transform duration-200 shrink-0 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed top-16 left-3 right-3 sm:left-auto sm:right-auto sm:absolute sm:top-full sm:mt-1.5 z-50 bg-stone-900 text-white text-xs font-semibold px-3 py-2 rounded-xl border border-stone-800 shadow-xl flex items-center justify-center sm:justify-start gap-2 whitespace-nowrap animate-in fade-in slide-in-from-top-1">
          <Languages className="w-4 h-4 text-blue-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Dropdown Popover */}
      {isOpen && (
        <>
          {/* Mobile backdrop */}
          <div 
            className="fixed inset-0 bg-stone-950/40 backdrop-blur-2xs z-40 sm:hidden"
            onClick={() => setIsOpen(false)}
          />

          <div className="fixed top-16 left-3 right-3 sm:absolute sm:top-full sm:left-0 sm:right-auto lg:left-auto lg:right-0 sm:mt-2 w-auto sm:w-[420px] max-w-[calc(100vw-1.5rem)] bg-white rounded-2xl border border-stone-200/90 shadow-2xl shadow-stone-900/15 z-50 animate-in fade-in slide-in-from-top-2 duration-200 overflow-hidden">
            
            {/* Popover Header */}
            <div className="bg-stone-50/90 px-4 py-3.5 border-b border-stone-200/80 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0 shadow-2xs">
                  <Globe className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-stone-900 leading-tight">Language Preferences</h3>
                  <p className="text-[11px] text-stone-500 font-normal mt-0.5">Customize learning target, AI tutor hints & UI</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-200/60 rounded-lg transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Target vs Native vs App UI Segmented Tab Switch */}
            <div className="p-2 bg-stone-100/70 border-b border-stone-200/70">
              <div className="grid grid-cols-3 gap-1 bg-stone-200/50 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setActiveTab("target")}
                  className={`py-2 px-2 text-xs font-bold text-center rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    activeTab === "target"
                      ? "bg-white text-stone-950 shadow-xs border border-stone-200/80 font-bold"
                      : "text-stone-600 hover:text-stone-900 hover:bg-stone-100/60"
                  }`}
                >
                  <span className="text-sm shrink-0">{targetFlag}</span>
                  <span className="truncate">Target</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("native")}
                  className={`py-2 px-2 text-xs font-bold text-center rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    activeTab === "native"
                      ? "bg-white text-stone-950 shadow-xs border border-stone-200/80 font-bold"
                      : "text-stone-600 hover:text-stone-900 hover:bg-stone-100/60"
                  }`}
                >
                  <span className="text-sm shrink-0">{nativeFlag}</span>
                  <span className="truncate">Native</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("app")}
                  className={`py-2 px-2 text-xs font-bold text-center rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    activeTab === "app"
                      ? "bg-white text-stone-950 shadow-xs border border-stone-200/80 font-bold"
                      : "text-stone-600 hover:text-stone-900 hover:bg-stone-100/60"
                  }`}
                >
                  <span className="text-sm shrink-0">{appFlag}</span>
                  <span className="truncate">App UI</span>
                </button>
              </div>

              {/* Dynamic Context Description for Selected Tab */}
              <div className="mt-2 px-2 text-[11px] text-stone-500 font-medium flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                <span>
                  {activeTab === "target" && "Language you are learning and practicing vocabulary in."}
                  {activeTab === "native" && "Language used by AI tutor for definitions, translations & explanations."}
                  {activeTab === "app" && "Language used for buttons, navigation tabs & app UI labels."}
                </span>
              </div>
            </div>

            {/* Quick Filter Search Bar */}
            <div className="p-3 pb-1 border-b border-stone-100">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter languages..."
                  className="w-full pl-8 pr-3 py-1.5 bg-stone-50 border border-stone-200/90 rounded-lg text-xs text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-stone-900 focus:bg-white transition-all"
                />
              </div>
            </div>

            {/* Language Selection Grid */}
            <div className="p-3 max-h-[270px] overflow-y-auto grid grid-cols-2 gap-2">
              {filteredLanguages.length === 0 ? (
                <div className="col-span-2 py-6 text-center text-xs text-stone-400">
                  No matching languages found
                </div>
              ) : (
                filteredLanguages.map((lang) => {
                  const isSelected = activeTab === "target" 
                    ? currentTarget.toLowerCase() === lang.code.toLowerCase()
                    : activeTab === "native"
                    ? currentNative.toLowerCase() === lang.code.toLowerCase()
                    : currentApp.toLowerCase() === lang.code.toLowerCase();

                  return (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => {
                        if (activeTab === "target") {
                          handleChooseTarget(lang.code);
                        } else if (activeTab === "native") {
                          handleChooseNative(lang.code);
                        } else {
                          handleChooseApp(lang.code);
                        }
                      }}
                      className={`flex items-center justify-between p-2.5 rounded-xl text-xs text-left border transition-all cursor-pointer ${
                        isSelected
                          ? "bg-stone-900 text-white border-stone-950 font-semibold shadow-xs"
                          : "bg-stone-50/70 hover:bg-stone-100/90 text-stone-800 border-stone-200/80 hover:border-stone-300"
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0 pr-1">
                        <span className="text-base shrink-0">{lang.flag}</span>
                        <div className="min-w-0">
                          <div className="font-bold truncate text-xs leading-tight">{lang.name}</div>
                          {lang.nativeName && (
                            <div className={`text-[10px] truncate ${isSelected ? "text-stone-300" : "text-stone-400"}`}>
                              {lang.nativeName}
                            </div>
                          )}
                        </div>
                      </div>
                      {isSelected && <Check className="w-4 h-4 text-emerald-400 shrink-0 ml-1" />}
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer summary */}
            <div className="px-4 py-2.5 bg-stone-50/90 border-t border-stone-200/80 text-[11px] text-stone-600 flex items-center justify-between">
              <div className="flex items-center gap-2 font-medium truncate">
                <span className="text-stone-400">Active Setup:</span>
                <span className="bg-stone-200/80 text-stone-800 px-2 py-0.5 rounded-md font-semibold text-[10px]">
                  {targetFlag} {currentTarget} → {nativeFlag} {currentNative}
                </span>
              </div>
              <span className="text-stone-400 text-[10px] shrink-0">Auto-saved</span>
            </div>

          </div>
        </>
      )}

    </div>
  );
}

