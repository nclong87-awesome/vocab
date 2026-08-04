import React from "react";
import { CheckSquare, Brain, Sparkles, Plus, FileText, HelpCircle, Languages, RotateCcw, Layers } from "lucide-react";

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
  }) => void;
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
      getAction: ({ onFixGrammar }) => onFixGrammar()
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
      getAction: ({ onStartQuiz }) => onStartQuiz()
    },
    {
      id: "view_flashcard",
      label: "Flash Card",
      category: "study",
      categoryLabel: "Study",
      icon: <Layers className="w-4 h-4 text-indigo-600" />,
      title: "View Word Flash Card",
      description: "Practice candidate words as interactive AI flash cards with speech & extra contextual example sentences",
      className: "bg-indigo-50 hover:bg-indigo-100 text-indigo-950 border border-indigo-300/80 text-xs font-bold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 2,
      getAction: ({ onViewFlashcard }) => onViewFlashcard?.()
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
      defaultIndex: 2,
      getAction: ({ onGenerateByTopic }) => onGenerateByTopic()
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
      defaultIndex: 3,
      getAction: ({ onAddWord }) => onAddWord()
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
      defaultIndex: 4,
      getAction: ({ targetLanguage, nativeLanguage, onSendMessage, onClearHistory }) => {
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
      defaultIndex: 5,
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
      defaultIndex: 6,
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
      defaultIndex: 7,
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
      defaultIndex: 7,
      getAction: ({ onClearHistory }) => onClearHistory()
    }
  ];
}
