import React, { useState, useRef, useEffect } from "react";
import { Globe, ChevronDown, Check, ArrowRight, Languages, Sparkles } from "lucide-react";
import { SUPPORTED_LANGUAGES, getLanguageFlag } from "../../config/languages";

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
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="relative inline-block text-left shrink-0" ref={dropdownRef} id="quick-lang-switcher">
      
      {/* Header Button Badge */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1 sm:gap-1.5 px-1.5 py-1 sm:px-3 sm:py-1.5 border text-[11px] sm:text-xs font-semibold transition-all cursor-pointer shadow-2xs shrink-0 ${
          isOpen
            ? "bg-stone-900 text-white border-stone-950 ring-2 ring-stone-900/20"
            : "bg-stone-50 hover:bg-stone-100 border-stone-200 text-stone-900"
        }`}
        title="Quick Language Switcher (Target & Native Language)"
      >
        <Globe className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-blue-600 shrink-0" />
        
        <div className="flex items-center gap-0.5 sm:gap-1">
          {/* Mobile view (< sm): flags only */}
          <span className="sm:hidden font-bold flex items-center gap-0.5">
            <span>{targetFlag}</span>
            <ArrowRight className="w-2 h-2 opacity-50" />
            <span>{nativeFlag}</span>
          </span>

          {/* Tablet view (sm -> lg): target flag & name -> native flag */}
          <span className="hidden sm:inline lg:hidden font-bold">
            {targetFlag} {currentTarget} <span className="opacity-50">→</span> {nativeFlag}
          </span>

          {/* Desktop view (>= lg): full names */}
          <span className="hidden lg:inline font-bold">{targetFlag} {currentTarget}</span>
          <ArrowRight className="hidden lg:inline w-2.5 h-2.5 opacity-50" />
          <span className="hidden lg:inline text-stone-500 font-normal">{nativeFlag} {currentNative}</span>
        </div>

        <ChevronDown className={`w-3 h-3 sm:w-3.5 sm:h-3.5 opacity-60 transition-transform shrink-0 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {/* Toast Feedback */}
      {toastMessage && (
        <div className="fixed top-16 left-3 right-3 sm:left-auto sm:right-auto sm:absolute sm:top-full sm:mt-1 z-50 bg-stone-900 text-white text-[11px] font-semibold px-2.5 py-1.5 border border-stone-800 shadow-md flex items-center justify-center sm:justify-start gap-1.5 whitespace-nowrap animate-in fade-in">
          <Languages className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Dropdown Popover */}
      {isOpen && (
        <>
          {/* Backdrop on mobile to prevent accidental background interaction & close on tap */}
          <div 
            className="fixed inset-0 bg-stone-950/40 backdrop-blur-2xs z-40 sm:hidden"
            onClick={() => setIsOpen(false)}
          />

          <div className="fixed top-16 left-3 right-3 sm:absolute sm:top-full sm:left-auto sm:right-0 sm:mt-2 w-auto sm:w-88 max-w-full bg-white border border-stone-300 shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 overflow-hidden">
            
            {/* Header */}
            <div className="bg-stone-900 text-white p-3 border-b border-stone-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-blue-400" />
                <span className="text-xs font-bold uppercase tracking-wider">Language Preferences</span>
              </div>
              <span className="text-[10px] text-stone-400 hidden xs:inline">AI Explanations</span>
            </div>

            {/* Target vs Native vs App UI Tab Switch */}
            <div className="flex border-b border-stone-200 bg-stone-100 p-1 gap-1">
              <button
                type="button"
                onClick={() => setActiveTab("target")}
                className={`flex-1 py-1.5 px-1 sm:px-2 text-[11px] sm:text-xs font-bold text-center transition-all cursor-pointer ${
                  activeTab === "target"
                    ? "bg-white text-stone-900 border border-stone-300 shadow-xs"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                Target ({targetFlag})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("native")}
                className={`flex-1 py-1.5 px-1 sm:px-2 text-[11px] sm:text-xs font-bold text-center transition-all cursor-pointer ${
                  activeTab === "native"
                    ? "bg-white text-stone-900 border border-stone-300 shadow-xs"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                Native ({nativeFlag})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("app")}
                className={`flex-1 py-1.5 px-1 sm:px-2 text-[11px] sm:text-xs font-bold text-center transition-all cursor-pointer ${
                  activeTab === "app"
                    ? "bg-white text-stone-900 border border-stone-300 shadow-xs"
                    : "text-stone-600 hover:text-stone-900"
                }`}
              >
                App UI ({appFlag})
              </button>
            </div>

            {/* Language Selection List */}
            <div className="p-2.5 max-h-60 sm:max-h-64 overflow-y-auto grid grid-cols-2 gap-1.5">
              {SUPPORTED_LANGUAGES.map((lang) => {
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
                    className={`flex items-center justify-between p-2 text-xs text-left border transition-all cursor-pointer ${
                      isSelected
                        ? "bg-stone-900 text-white border-stone-950 font-bold"
                        : "bg-stone-50 hover:bg-stone-100 text-stone-800 border-stone-200"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="text-sm shrink-0">{lang.flag}</span>
                      <span className="truncate">{lang.name}</span>
                    </div>
                    {isSelected && <Check className="w-3.5 h-3.5 text-blue-400 shrink-0" />}
                  </button>
                );
              })}
            </div>

            {/* Footer note */}
            <div className="p-2.5 bg-stone-50 border-t border-stone-200 text-[11px] text-stone-500 flex items-center justify-between flex-wrap gap-1">
              <span>Updates AI tutor and coach settings</span>
            </div>

          </div>
        </>
      )}

    </div>
  );
}
