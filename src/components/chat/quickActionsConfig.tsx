import React from "react";
import { CheckSquare, Brain, Sparkles, RotateCcw, BookOpen } from "lucide-react";
import { LLMProvider } from "../../types";
import PROVIDER_OPTIONS from "../../config/llmProviders";
import { 
  isModelLocked
} from "../../utils/autoModeManager";
import { t } from "../../config/i18n";

export interface QuickActionItem {
  id: string;
  label: string;
  category: "writing" | "study" | "vocab" | "chat";
  categoryLabel: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  className: string;
  defaultIndex: number;
  getAction: (params: {
    targetLanguage: string;
    nativeLanguage: string;
    onFixGrammar: () => void;
    startPractice: () => void;
    onGenerateByTopic: () => void;
    onAddWord: () => void;
    onSendMessage: (text: string) => void;
    onClearHistory: () => void;
    onSuggestCasualReplyPrompt?: () => void;
    onOpenWordLibrary?: () => void;
    onOpenChallenge?: () => void;
  }) => void;
}

export const DEFAULT_QUICK_ACTION_MODEL = {
  provider: "groq",
  model: "openai/gpt-oss-120b"
};

export function getDefaultQuickActionModel(): { provider: string; model: string } {
  return DEFAULT_QUICK_ACTION_MODEL;
}

/**
 * Find provider matching a specific model name across all available providers
 */
export function findProviderForModel(modelName: string): { provider: LLMProvider; model: string } | null {
  for (const option of PROVIDER_OPTIONS) {
    if (option.id === "auto") continue;
    if (option.models.includes(modelName)) {
      return { provider: option.id as LLMProvider, model: modelName };
    }
  }
  if (modelName.includes(":")) {
    const parts = modelName.split(":");
    const prov = parts[0] as LLMProvider;
    const mod = parts.slice(1).join(":");
    const found = PROVIDER_OPTIONS.find(p => p.id === prov);
    if (found && found.models.includes(mod)) {
      return { provider: prov, model: mod };
    }
  }
  return null;
}

/**
 * Sequential rotation for quick actions' default models list to avoid always using the first model.
 * Persists the last-used starting index in localStorage to ensure balanced rotation across user sessions.
 */
export function getRotatedDefaultModel(defaultModels: string[]): { provider: LLMProvider; model: string } | null {
  if (!defaultModels || defaultModels.length === 0) return null;

  // Get current rotation index
  let rotationIndex = 0;
  const STORAGE_INDEX_KEY = "vocab_quick_actions_rotation_index";
  try {
    const saved = localStorage.getItem(STORAGE_INDEX_KEY);
    if (saved) {
      rotationIndex = parseInt(saved, 10);
      if (isNaN(rotationIndex)) rotationIndex = 0;
    }
  } catch (e) {
    console.error("Failed to read quick action rotation index:", e);
  }

  // Find the first matching model that is not locked, starting from rotationIndex
  const len = defaultModels.length;
  for (let i = 0; i < len; i++) {
    const currentIndex = (rotationIndex + i) % len;
    const modelName = defaultModels[currentIndex];
    const match = findProviderForModel(modelName);
    
    if (match && !isModelLocked(match.provider, match.model)) {
      // Found a valid and unlocked model!
      // Update the index for next time to be the one after this chosen model
      const nextIndex = (currentIndex + 1) % len;
      try {
        localStorage.setItem(STORAGE_INDEX_KEY, String(nextIndex));
      } catch (e) {}
      
      return match;
    }
  }

  // Fallback: if all of them starting from rotationIndex are locked or invalid, find any unlocked model starting from index 0
  for (const modelName of defaultModels) {
    const match = findProviderForModel(modelName);
    if (match && !isModelLocked(match.provider, match.model)) {
      return match;
    }
  }

  return null;
}

export function getQuickActionItems(appLanguage: string = "Vietnamese"): QuickActionItem[] {
  return [
    {
      id: "generate_topic",
      label: t("qa_generate_words_label", appLanguage),
      category: "vocab",
      categoryLabel: t("qa_cat_vocab", appLanguage),
      icon: <Sparkles className="w-4 h-4 text-amber-500" />,
      title: t("qa_generate_words_title", appLanguage),
      description: t("qa_generate_words_desc", appLanguage),
      className: "bg-white hover:bg-stone-50 text-stone-900 border border-stone-200 text-xs font-bold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 0,
      getAction: ({ onGenerateByTopic, onClearHistory }) => {
        onClearHistory();
        onGenerateByTopic();
      }
    },
    {
      id: "import_library",
      label: t("qa_import_library_label", appLanguage),
      category: "vocab",
      categoryLabel: t("qa_cat_vocab", appLanguage),
      icon: <BookOpen className="w-4 h-4 text-sky-600" />,
      title: t("qa_import_library_title", appLanguage),
      description: t("qa_import_library_desc", appLanguage),
      className: "bg-sky-50/80 hover:bg-sky-100 text-sky-950 border border-sky-300/80 text-xs font-bold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 1,
      getAction: ({ onOpenWordLibrary, onClearHistory }) => {
        onClearHistory();
        onOpenWordLibrary?.();
      }
    },
    {
      id: "practice",
      label: t("qa_practice_label", appLanguage),
      category: "study",
      categoryLabel: t("qa_cat_study", appLanguage),
      icon: <Brain className="w-4 h-4 text-amber-600" />,
      title: t("qa_practice_title", appLanguage),
      description: t("qa_practice_desc", appLanguage),
      className: "bg-stone-900 hover:bg-stone-800 text-white text-xs font-bold py-1.5 px-3 rounded-full shadow-xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 2,
      getAction: ({ startPractice, onClearHistory }) => {
        onClearHistory();
        startPractice();
      }
    },
    {
      id: "fix_grammar",
      label: t("qa_fix_grammar_label", appLanguage),
      category: "writing",
      categoryLabel: t("qa_cat_writing", appLanguage),
      icon: <CheckSquare className="w-4 h-4 text-rose-600" />,
      title: t("qa_fix_grammar_title", appLanguage),
      description: t("qa_fix_grammar_desc", appLanguage),
      className: "bg-rose-50 hover:bg-rose-100 text-rose-950 border border-rose-300/80 text-xs font-bold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 3,
      getAction: ({ onFixGrammar, onClearHistory }) => {
        onClearHistory();
        onFixGrammar();
      }
    },
    {
      id: "suggest_reply",
      label: t("qa_suggest_reply_label", appLanguage),
      category: "writing",
      categoryLabel: t("qa_cat_writing", appLanguage),
      icon: <Sparkles className="w-4 h-4 text-amber-500" />,
      title: t("qa_suggest_reply_title", appLanguage),
      description: t("qa_suggest_reply_desc", appLanguage),
      className: "bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-300/80 text-xs font-bold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 4,
      getAction: ({ onSuggestCasualReplyPrompt, onClearHistory }) => {
        onClearHistory();
        onSuggestCasualReplyPrompt?.();
      }
    },
    {
      id: "new_chat",
      label: t("qa_new_chat_label", appLanguage),
      category: "chat",
      categoryLabel: t("qa_cat_chat", appLanguage),
      icon: <RotateCcw className="w-4 h-4 text-stone-500" />,
      title: t("qa_new_chat_title", appLanguage),
      description: t("qa_new_chat_desc", appLanguage),
      className: "bg-white hover:bg-stone-50 text-stone-700 hover:text-stone-900 border border-stone-200 text-xs font-semibold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 5,
      getAction: ({ onClearHistory }) => onClearHistory()
    }
  ];
}


