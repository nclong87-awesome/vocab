import React, { useState, useEffect } from "react";
import { CheckSquare, Brain, Sparkles, Plus, FileText, HelpCircle, Languages, RotateCcw, Layers, Cpu, CheckCircle2, AlertTriangle, RefreshCw } from "lucide-react";
import { LLMConfig, LLMProvider } from "../../types";
import PROVIDER_OPTIONS, { RELIABLE_MODELS } from "../../config/llmProviders";
import { 
  isModelLocked,
  clearAllLocks,
  getLockedModels
} from "../../utils/autoModeManager";

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
  defaultModels: string[];
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

/**
 * UI Component displaying the hard-coded Default AI Model for Quick Actions & Auto Mode
 */
export function QuickActionsModelConfig({ 
  llmConfig, 
  onToast 
}: { 
  llmConfig?: LLMConfig; 
  onToast?: (msg: string) => void; 
}) {
  const defaultModelObj = getDefaultQuickActionModel();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    // Keep in sync on prop or refresh change
  }, [llmConfig, refreshKey]);

  const isLocked = isModelLocked(defaultModelObj.provider, defaultModelObj.model);
  const lockedCount = Object.keys(getLockedModels()).length;

  const handleResetLocks = () => {
    clearAllLocks();
    if (onToast) onToast("Cleared all model lockouts!");
    setRefreshKey(prev => prev + 1);
  };

  return (
    <div className="bg-stone-900 text-stone-100 p-3 sm:p-3.5 rounded-xl border border-stone-800 shadow-md space-y-2.5 my-2">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-stone-800/80 pb-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 shrink-0">
            <Cpu className="w-4 h-4" />
          </div>
          <div>
            <h5 className="text-xs font-bold text-stone-100 flex flex-wrap items-center gap-1.5">
              Quick Actions Default AI Model
              {isLocked ? (
                <span className="text-[10px] bg-amber-950 text-amber-300 border border-amber-800 px-1.5 py-0.2 rounded font-semibold flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3 text-amber-400" /> Locked (Fallback Active)
                </span>
              ) : (
                <span className="text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800 px-1.5 py-0.2 rounded font-semibold flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3 text-emerald-400" /> Default Primary
                </span>
              )}
            </h5>
            <p className="text-[11px] text-stone-400 leading-tight mt-0.5">
              Actions bind to assigned default models (e.g. Add Word → <code>gemma4:31b</code>). Uses that model for the session.
            </p>
          </div>
        </div>

        {/* Read-Only Hard-Coded Model Display */}
        <div className="shrink-0">
          <div className="bg-stone-950 text-amber-300 border border-stone-700/80 rounded-lg px-3 py-1.5 text-xs font-bold font-mono flex items-center gap-1.5">
            <span className="text-stone-400 text-[10px] font-sans font-medium uppercase">{defaultModelObj.provider}:</span>
            <span>{defaultModelObj.model}</span>
          </div>
        </div>
      </div>

      {/* Auto Switch / Failover Status Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between text-[11px] text-stone-400 bg-stone-950/60 p-2 rounded-lg border border-stone-800/80 gap-2">
        <div className="flex items-center gap-1.5">
          <span className="text-amber-400 font-bold">⚡ Session Binding:</span>
          <span>Quick action sets session model (e.g. <code className="text-amber-300 font-mono">gemma4:31b</code>). Next model used if locked.</span>
        </div>

        {lockedCount > 0 && (
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
            <span className="text-amber-300 text-[10px] font-medium">
              ⚠️ {lockedCount} model(s) locked
            </span>
            <button
              type="button"
              onClick={handleResetLocks}
              className="text-[10px] font-bold text-amber-400 hover:text-white underline cursor-pointer flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Reset Locks
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function getQuickActionItems(): QuickActionItem[] {
  return [
    {
      id: "fix_grammar",
      label: "Fix Grammar",
      category: "writing",
      categoryLabel: "Writing",
      icon: <CheckSquare className="w-4 h-4 text-amber-600" />,
      title: "Fix Grammar & Polish",
      description: "Check spelling, grammar, and improve natural clarity",
      className: "bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-300/80 text-xs font-bold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 0,
      defaultModels: [],
      getAction: ({ onFixGrammar, onClearHistory }) => {
        onClearHistory();
        onFixGrammar();
      }
    },
    {
      id: "start_quiz",
      label: "Start Quiz",
      category: "study",
      categoryLabel: "Study",
      icon: <Brain className="w-4 h-4 text-amber-600" />,
      title: "Start Today's Quiz",
      description: "Interactive flashcards and recall challenge",
      className: "bg-stone-900 hover:bg-stone-800 text-white text-xs font-bold py-1.5 px-3 rounded-full shadow-xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 1,
      defaultModels: [],
      getAction: ({ onStartQuiz, onClearHistory }) => {
        onClearHistory();
        onStartQuiz();
      }
    },
    {
      id: "view_flashcard",
      label: "Flash Card",
      category: "study",
      categoryLabel: "Study",
      icon: <Layers className="w-4 h-4 text-indigo-600" />,
      title: "Flash Card",
      description: "Practice candidate words as interactive AI flash cards with speech & extra contextual example sentences",
      className: "bg-indigo-50 hover:bg-indigo-100 text-indigo-950 border border-indigo-300/80 text-xs font-bold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 2,
      defaultModels: [],
      getAction: ({ onViewFlashcard, onClearHistory }) => {
        onClearHistory();
        onViewFlashcard?.();
      }
    },
    {
      id: "generate_topic",
      label: "Generate Words",
      category: "vocab",
      categoryLabel: "Vocab",
      icon: <Sparkles className="w-4 h-4 text-amber-500" />,
      title: "Generate Words",
      description: "Build vocabulary around travel, business, or custom topics",
      className: "bg-white hover:bg-stone-50 text-stone-900 border border-stone-200 text-xs font-bold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 3,
      defaultModels: RELIABLE_MODELS,
      getAction: ({ onGenerateByTopic, onClearHistory }) => {
        onClearHistory();
        onGenerateByTopic();
      }
    },
    {
      id: "add_word",
      label: "Add Word",
      category: "vocab",
      categoryLabel: "Vocab",
      icon: <Plus className="w-4 h-4 text-green-600" />,
      title: "Add Word to Collection",
      description: "Manually store new words with notes & definitions",
      className: "bg-white hover:bg-stone-50 text-stone-900 border border-stone-200 text-xs font-bold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 4,
      defaultModels: RELIABLE_MODELS,
      getAction: ({ onAddWord, onClearHistory }) => {
        onClearHistory();
        onAddWord();
      }
    },
    {
      id: "interactive_chat_coach",
      label: "Interactive AI Prompts",
      category: "writing",
      categoryLabel: "Writing",
      icon: <Sparkles className="w-4 h-4 text-amber-500" />,
      title: "Interactive Language Coach",
      description: "Ask AI coach for interactive guidance on Grammar Rules, Nuance Translation, or Situational Phrases",
      className: "bg-amber-100/90 hover:bg-amber-200 text-amber-950 border border-amber-300 text-xs font-bold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 5,
      defaultModels: RELIABLE_MODELS,
      getAction: ({ targetLanguage: _targetLanguage, nativeLanguage: _nativeLanguage, onSendMessage, onClearHistory }) => {
        onClearHistory();
        onSendMessage(
          `Help me practice with Interactive Language Prompts (Grammar, Translation, or Common Phrases).`
        );
      }
    },
    {
      id: "explain_grammar",
      label: "Explain Grammar Rules",
      category: "writing",
      categoryLabel: "Writing",
      icon: <FileText className="w-4 h-4 text-blue-600" />,
      title: "Explain Grammar Rules (in Native Language)",
      description: "Ask AI coach for a breakdown of grammar rules & syntax in your native language",
      className: "bg-blue-50/70 hover:bg-blue-100 text-blue-950 border border-blue-200 text-xs font-semibold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 6,
      defaultModels: RELIABLE_MODELS,
      getAction: ({ targetLanguage, nativeLanguage, onSendMessage, onClearHistory }) => {
        onClearHistory();
        onSendMessage(
          `I'd like to explore grammar rules in ${targetLanguage} (explained in ${nativeLanguage}).`
        );
      }
    },
    {
      id: "common_phrases",
      label: "Common Phrases",
      category: "study",
      categoryLabel: "Study",
      icon: <HelpCircle className="w-4 h-4 text-emerald-600" />,
      title: "Common Phrases & Idioms",
      description: "Learn essential daily expressions & conversational idioms by topic or scenario",
      className: "bg-emerald-50/70 hover:bg-emerald-100 text-emerald-950 border border-emerald-200 text-xs font-semibold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 7,
      defaultModels: RELIABLE_MODELS,
      getAction: ({ targetLanguage, nativeLanguage, onSendMessage, onClearHistory }) => {
        onClearHistory();
        onSendMessage(
          `I'd like to learn common phrases and idioms in ${targetLanguage} (with ${nativeLanguage} translations).`
        );
      }
    },
    {
      id: "translate_contrast",
      label: "Translate & Compare",
      category: "writing",
      categoryLabel: "Writing",
      icon: <Languages className="w-4 h-4 text-purple-600" />,
      title: "Translate & Contrast",
      description: "Compare nuances between native phrasing and target language for custom sentences",
      className: "bg-purple-50/70 hover:bg-purple-100 text-purple-950 border border-purple-200 text-xs font-semibold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 8,
      defaultModels: RELIABLE_MODELS,
      getAction: ({ targetLanguage, nativeLanguage, onSendMessage, onClearHistory }) => {
        onClearHistory();
        onSendMessage(
          `I'd like to translate a phrase and compare nuances between ${nativeLanguage} and ${targetLanguage}.`
        );
      }
    },
    {
      id: "new_chat",
      label: "Start New Chat",
      category: "chat",
      categoryLabel: "Chat",
      icon: <RotateCcw className="w-4 h-4 text-stone-500" />,
      title: "Start Fresh Chat Session",
      description: "Clear current conversation thread and start fresh",
      className: "bg-white hover:bg-stone-50 text-stone-700 hover:text-stone-900 border border-stone-200 text-xs font-semibold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 9,
      defaultModels: [],
      getAction: ({ onClearHistory }) => onClearHistory()
    }
  ];
}


