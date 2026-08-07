import { useState, useCallback } from "react";

export function useLanguages() {
  const [targetLanguage, setTargetLanguage] = useState<string>(() => {
    return localStorage.getItem("vocab_learner_target_lang") || "English";
  });
  const [nativeLanguage, setNativeLanguage] = useState<string>(() => {
    return localStorage.getItem("vocab_learner_native_lang") || "Vietnamese";
  });
  const [appLanguage, setAppLanguage] = useState<string>(() => {
    const storedApp = localStorage.getItem("vocab_learner_app_lang");
    if (storedApp) return storedApp;
    return localStorage.getItem("vocab_learner_native_lang") || "Vietnamese";
  });

  const handleSelectLanguages = useCallback((targetLang: string, nativeLang: string, appLang?: string) => {
    setTargetLanguage(targetLang);
    setNativeLanguage(nativeLang);
    const newAppLang = appLang || nativeLang;
    setAppLanguage(newAppLang);
    try {
      localStorage.setItem("vocab_learner_target_lang", targetLang);
      localStorage.setItem("vocab_learner_native_lang", nativeLang);
      localStorage.setItem("vocab_learner_app_lang", newAppLang);
    } catch (e) {
      console.error("Failed to save language preferences to localStorage", e);
    }
  }, []);

  return {
    targetLanguage,
    setTargetLanguage,
    nativeLanguage,
    setNativeLanguage,
    appLanguage,
    setAppLanguage,
    handleSelectLanguages,
  };
}
