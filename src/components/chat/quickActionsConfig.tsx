import React from "react";
import { CheckSquare, Brain, Sparkles, Plus, FileText, HelpCircle, Languages, RotateCcw, Layers } from "lucide-react";
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
    onStartQuiz: () => void;
    onGenerateByTopic: () => void;
    onAddWord: () => void;
    onSendMessage: (text: string) => void;
    onClearHistory: () => void;
    onViewFlashcard?: () => void;
    onSuggestCasualReplyPrompt?: () => void;
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
export function findProviderForModel(modelName: string): { provider: LLMProvider; model: string; baseUrl: string } | null {
  for (const option of PROVIDER_OPTIONS) {
    if (option.id === "auto") continue;
    if (option.models.includes(modelName)) {
      return { provider: option.id as LLMProvider, model: modelName, baseUrl: option.directBaseUrl || option.defaultBaseUrl || "" };
    }
  }
  if (modelName.includes(":")) {
    const parts = modelName.split(":");
    const prov = parts[0] as LLMProvider;
    const mod = parts.slice(1).join(":");
    const found = PROVIDER_OPTIONS.find(p => p.id === prov);
    if (found && found.models.includes(mod)) {
      return { provider: prov, model: mod, baseUrl: found.directBaseUrl || found.defaultBaseUrl || "" };
    }
  }
  return null;
}

/**
 * Sequential rotation for quick actions' default models list to avoid always using the first model.
 * Persists the last-used starting index in localStorage to ensure balanced rotation across user sessions.
 */
export function getRotatedDefaultModel(defaultModels: string[]): { provider: LLMProvider; model: string, baseUrl: string } | null {
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
      id: "add_word",
      label: t("qa_add_word_label", appLanguage),
      category: "vocab",
      categoryLabel: t("qa_cat_vocab", appLanguage),
      icon: <Plus className="w-4 h-4 text-green-600" />,
      title: t("qa_add_word_title", appLanguage),
      description: t("qa_add_word_desc", appLanguage),
      className: "bg-white hover:bg-stone-50 text-stone-900 border border-stone-200 text-xs font-bold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 0,
      getAction: ({ onAddWord, onClearHistory }) => {
        onClearHistory();
        onAddWord();
      }
    },
    {
      id: "generate_topic",
      label: t("qa_generate_words_label", appLanguage),
      category: "vocab",
      categoryLabel: t("qa_cat_vocab", appLanguage),
      icon: <Sparkles className="w-4 h-4 text-amber-500" />,
      title: t("qa_generate_words_title", appLanguage),
      description: t("qa_generate_words_desc", appLanguage),
      className: "bg-white hover:bg-stone-50 text-stone-900 border border-stone-200 text-xs font-bold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 1,
      getAction: ({ onGenerateByTopic, onClearHistory }) => {
        onClearHistory();
        onGenerateByTopic();
      }
    },
    {
      id: "view_flashcard",
      label: t("qa_flash_card_label", appLanguage),
      category: "study",
      categoryLabel: t("qa_cat_study", appLanguage),
      icon: <Layers className="w-4 h-4 text-indigo-600" />,
      title: t("qa_flash_card_title", appLanguage),
      description: t("qa_flash_card_desc", appLanguage),
      className: "bg-indigo-50 hover:bg-indigo-100 text-indigo-950 border border-indigo-300/80 text-xs font-bold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 2,
      getAction: ({ onViewFlashcard, onClearHistory }) => {
        onClearHistory();
        onViewFlashcard?.();
      }
    },
    {
      id: "start_quiz",
      label: t("qa_start_quiz_label", appLanguage),
      category: "study",
      categoryLabel: t("qa_cat_study", appLanguage),
      icon: <Brain className="w-4 h-4 text-amber-600" />,
      title: t("qa_start_quiz_title", appLanguage),
      description: t("qa_start_quiz_desc", appLanguage),
      className: "bg-stone-900 hover:bg-stone-800 text-white text-xs font-bold py-1.5 px-3 rounded-full shadow-xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 3,
      getAction: ({ onStartQuiz, onClearHistory }) => {
        onClearHistory();
        onStartQuiz();
      }
    },
    {
      id: "fix_grammar",
      label: t("qa_fix_grammar_label", appLanguage),
      category: "writing",
      categoryLabel: t("qa_cat_writing", appLanguage),
      icon: <CheckSquare className="w-4 h-4 text-amber-600" />,
      title: t("qa_fix_grammar_title", appLanguage),
      description: t("qa_fix_grammar_desc", appLanguage),
      className: "bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-300/80 text-xs font-bold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 4,
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
      defaultIndex: 5,
      getAction: ({ onSuggestCasualReplyPrompt, onClearHistory }) => {
        onClearHistory();
        onSuggestCasualReplyPrompt?.();
      }
    },
    // {
    //   id: "interactive_chat_coach",
    //   label: t("qa_interactive_prompts_label", appLanguage),
    //   category: "writing",
    //   categoryLabel: t("qa_cat_writing", appLanguage),
    //   icon: <Sparkles className="w-4 h-4 text-amber-500" />,
    //   title: t("qa_interactive_prompts_title", appLanguage),
    //   description: t("qa_interactive_prompts_desc", appLanguage),
    //   className: "bg-amber-100/90 hover:bg-amber-200 text-amber-950 border border-amber-300 text-xs font-bold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
    //   defaultIndex: 6,
    //   defaultModels: RELIABLE_MODELS,
    //   getAction: ({ onSendMessage, onClearHistory }) => {
    //     onClearHistory();
    //     onSendMessage(
    //       `Help me practice with Interactive Language Prompts (Grammar, Translation, or Common Phrases).`
    //     );
    //   }
    // },
    {
      id: "explain_grammar",
      label: t("qa_explain_grammar_label", appLanguage),
      category: "writing",
      categoryLabel: t("qa_cat_writing", appLanguage),
      icon: <FileText className="w-4 h-4 text-blue-600" />,
      title: t("qa_explain_grammar_title", appLanguage),
      description: t("qa_explain_grammar_desc", appLanguage),
      className: "bg-blue-50/70 hover:bg-blue-100 text-blue-950 border border-blue-200 text-xs font-semibold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 7,
      getAction: ({ targetLanguage, nativeLanguage, onSendMessage, onClearHistory }) => {
        onClearHistory();
        onSendMessage(
          `I'd like to explore grammar rules in ${targetLanguage} (explained in ${nativeLanguage}).`
        );
      }
    },
    {
      id: "common_phrases",
      label: t("qa_common_phrases_label", appLanguage),
      category: "study",
      categoryLabel: t("qa_cat_study", appLanguage),
      icon: <HelpCircle className="w-4 h-4 text-emerald-600" />,
      title: t("qa_common_phrases_title", appLanguage),
      description: t("qa_common_phrases_desc", appLanguage),
      className: "bg-emerald-50/70 hover:bg-emerald-100 text-emerald-950 border border-emerald-200 text-xs font-semibold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 8,
      getAction: ({ targetLanguage, nativeLanguage, onSendMessage, onClearHistory }) => {
        onClearHistory();
        onSendMessage(
          `I'd like to learn common phrases and idioms in ${targetLanguage} (with ${nativeLanguage} translations).`
        );
      }
    },
    {
      id: "translate_contrast",
      label: t("qa_translate_contrast_label", appLanguage),
      category: "writing",
      categoryLabel: t("qa_cat_writing", appLanguage),
      icon: <Languages className="w-4 h-4 text-purple-600" />,
      title: t("qa_translate_contrast_title", appLanguage),
      description: t("qa_translate_contrast_desc", appLanguage),
      className: "bg-purple-50/70 hover:bg-purple-100 text-purple-950 border border-purple-200 text-xs font-semibold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 9,
      getAction: ({ targetLanguage, nativeLanguage, onSendMessage, onClearHistory }) => {
        onClearHistory();
        onSendMessage(
          `I'd like to translate a phrase and compare nuances between ${nativeLanguage} and ${targetLanguage}.`
        );
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
      defaultIndex: 10,
      getAction: ({ onClearHistory }) => onClearHistory()
    }
  ];
}


