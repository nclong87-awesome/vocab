import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Send, Sparkles, Trash2, Plus, Volume2, Bot, User, 
  Brain, BookOpen, AlertCircle, HelpCircle, ChevronRight, Check, CheckSquare, RotateCcw,
  ChevronLeft, LayoutGrid, X, Search, Wand2, Languages, FileText
} from "lucide-react";
import { ChatMessage, LLMConfig, TTSConfig, Word } from "../types";
import { speakText, getLanguageCode } from "../utils/ttsService";
import { QuizImage } from "./QuizView";

interface ChatViewProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => Promise<void>;
  onClearHistory: () => void;
  isTyping: boolean;
  targetLanguage: string;
  nativeLanguage: string;
  onAddWord: (word?: string, hint?: string) => void;
  onGenerateByTopic: () => void;
  onStartQuiz: () => void;
  onFixGrammar: () => void;
  onSelectDefinition?: (word: string, senseIndex: number, translation: string) => void;
  ttsConfig: TTSConfig;
  llmConfig: LLMConfig;
  words: Word[];
}

// Inline custom markdown-like formatter
function FormattedMessage({ text }: { text: string }) {
  const lines = text.split("\n");
  
  return (
    <div className="space-y-1.5 text-sm sm:text-base leading-relaxed break-words">
      {lines.map((line, i) => {
        // Handle Bullet Points
        if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
          const content = line.trim().substring(2);
          return (
            <ul key={i} className="list-disc pl-5 my-1 text-stone-800">
              <li>{parseInlineMarkdown(content)}</li>
            </ul>
          );
        }
        
        // Handle Numbered List
        const numberedMatch = line.trim().match(/^(\d+)\.\s+(.*)/);
        if (numberedMatch) {
          return (
            <ol key={i} className="list-decimal pl-5 my-1 text-stone-800">
              <li value={parseInt(numberedMatch[1], 10)}>
                {parseInlineMarkdown(numberedMatch[2])}
              </li>
            </ol>
          );
        }

        // Handle Blockquotes
        if (line.trim().startsWith("> ")) {
          const content = line.trim().substring(2);
          return (
            <blockquote key={i} className="border-l-4 border-amber-400 bg-amber-50/70 pl-3 py-2 pr-2 my-2 text-stone-900 font-semibold rounded-r-lg shadow-2xs">
              {parseInlineMarkdown(content)}
            </blockquote>
          );
        }

        // Handle Headers
        if (line.trim().startsWith("### ")) {
          return (
            <h4 key={i} className="text-base font-bold text-stone-900 pt-2 pb-1">
              {parseInlineMarkdown(line.trim().substring(4))}
            </h4>
          );
        }
        if (line.trim().startsWith("## ")) {
          return (
            <h3 key={i} className="text-lg font-bold text-stone-900 pt-3 pb-1 border-b border-stone-100">
              {parseInlineMarkdown(line.trim().substring(3))}
            </h3>
          );
        }

        // Default paragraph
        if (line.trim() === "") {
          return <div key={i} className="h-2" />;
        }

        return <p key={i} className="text-stone-800">{parseInlineMarkdown(line)}</p>;
      })}
    </div>
  );
}

// Parse inline formatting (**bold**, `code`, etc.)
function parseInlineMarkdown(text: string) {
  // Simple regex-based inline parser
  const parts = [];
  let index = 0;
  
  // Combine bolding and code highlights
  const tokenRegex = /(\*\*|`)(.*?)\1/g;
  let match;
  
  while ((match = tokenRegex.exec(text)) !== null) {
    // Add text before match
    if (match.index > index) {
      parts.push(text.substring(index, match.index));
    }
    
    const type = match[1];
    const content = match[2];
    
    if (type === "**") {
      parts.push(<strong key={match.index} className="font-bold text-stone-950 bg-stone-100/40 px-0.5 rounded">{content}</strong>);
    } else if (type === "`") {
      parts.push(<code key={match.index} className="px-1 py-0.5 bg-stone-100 rounded text-amber-700 font-mono text-xs sm:text-sm font-semibold">{content}</code>);
    }
    
    index = tokenRegex.lastIndex;
  }
  
  if (index < text.length) {
    parts.push(text.substring(index));
  }
  
  return parts.length > 0 ? parts : text;
}

export default function ChatView({
  messages,
  onSendMessage,
  onClearHistory,
  isTyping,
  targetLanguage,
  nativeLanguage,
  onAddWord,
  onGenerateByTopic,
  onStartQuiz,
  onFixGrammar,
  onSelectDefinition,
  ttsConfig,
  llmConfig,
  words
}: ChatViewProps) {
  const [inputText, setInputText] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [isActionsPanelOpen, setIsActionsPanelOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<"all" | "writing" | "study" | "vocab" | "chat">("all");
  const [actionSearchQuery, setActionSearchQuery] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const latestMessageRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dockScrollRef = useRef<HTMLDivElement>(null);

  const focusInput = () => {
    // if mobile, skip focusing to avoid keyboard pop-up
    if (/Mobi|Android/i.test(navigator.userAgent)) return;
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  const handleScrollDock = (direction: "left" | "right") => {
    if (dockScrollRef.current) {
      const scrollAmount = direction === "left" ? -220 : 220;
      dockScrollRef.current.scrollBy({ left: scrollAmount, behavior: "smooth" });
    }
  };

  // Quick Actions Usage Counter (persisted in localStorage)
  const [actionCounts, setActionCounts] = useState<Record<string, number>>(() => {
    try {
      const stored = localStorage.getItem("vocab_action_usage_counts");
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.error(e);
    }
    return {};
  });

  const lastMessageIdRef = useRef<string | null>(null);

  const handleIncrementActionCount = (actionId: string) => {
    setActionCounts(prev => {
      const updated = { ...prev, [actionId]: (prev[actionId] || 0) + 1 };
      try {
        localStorage.setItem("vocab_action_usage_counts", JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }
      return updated;
    });
  };

  // Ordered quick action items with categories, descriptions, and icons
  const allQuickActionItems = [
    {
      id: "fix_grammar",
      label: "Fix Grammar",
      category: "writing" as const,
      categoryLabel: "Writing",
      icon: <CheckSquare className="w-4 h-4 text-amber-600" />,
      title: "Fix Grammar & Polish",
      description: "Check spelling, grammar, and improve natural clarity",
      className: "bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-300/80 text-xs font-bold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 0,
      onClick: () => {
        handleIncrementActionCount("fix_grammar");
        onFixGrammar();
        setIsActionsPanelOpen(false);
        scrollToBottom("smooth");
        focusInput();
      }
    },
    {
      id: "start_quiz",
      label: "Start Quiz",
      category: "study" as const,
      categoryLabel: "Study",
      icon: <Brain className="w-4 h-4 text-amber-600" />,
      title: "Start Today's Quiz",
      description: "Interactive flashcards and recall challenge",
      className: "bg-stone-900 hover:bg-stone-800 text-white text-xs font-bold py-1.5 px-3 rounded-full shadow-xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 1,
      onClick: () => {
        handleIncrementActionCount("start_quiz");
        onStartQuiz();
        setIsActionsPanelOpen(false);
        scrollToBottom("smooth");
        focusInput();
      }
    },
    {
      id: "generate_topic",
      label: "Generate Words",
      category: "vocab" as const,
      categoryLabel: "Vocab",
      icon: <Sparkles className="w-4 h-4 text-amber-500" />,
      title: "Generate Words",
      description: "Build vocabulary around travel, business, or custom topics",
      className: "bg-white hover:bg-stone-50 text-stone-900 border border-stone-200 text-xs font-bold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 2,
      onClick: () => {
        handleIncrementActionCount("generate_topic");
        onGenerateByTopic();
        setIsActionsPanelOpen(false);
        scrollToBottom("smooth");
        focusInput();
      }
    },
    {
      id: "add_word",
      label: "Add Word",
      category: "vocab" as const,
      categoryLabel: "Vocab",
      icon: <Plus className="w-4 h-4 text-green-600" />,
      title: "Add Word to Collection",
      description: "Manually store new words with notes & definitions",
      className: "bg-white hover:bg-stone-50 text-stone-900 border border-stone-200 text-xs font-bold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 3,
      onClick: () => {
        handleIncrementActionCount("add_word");
        onAddWord();
        setIsActionsPanelOpen(false);
        scrollToBottom("smooth");
        focusInput();
      }
    },
    {
      id: "explain_grammar",
      label: "Explain Grammar Rules",
      category: "writing" as const,
      categoryLabel: "Writing",
      icon: <FileText className="w-4 h-4 text-blue-600" />,
      title: "Explain Grammar Rules",
      description: "Ask AI coach for a simple breakdown of grammar structure",
      className: "bg-blue-50/70 hover:bg-blue-100 text-blue-950 border border-blue-200 text-xs font-semibold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 4,
      onClick: () => {
        handleIncrementActionCount("explain_grammar");
        setIsActionsPanelOpen(false);
        onSendMessage(`Can you explain the essential grammar rules and structures in ${targetLanguage} with quick clear examples?`);
        scrollToBottom("smooth");
        focusInput();
      }
    },
    {
      id: "common_phrases",
      label: "Common Phrases",
      category: "study" as const,
      categoryLabel: "Study",
      icon: <HelpCircle className="w-4 h-4 text-emerald-600" />,
      title: "Common Phrases & Idioms",
      description: "Learn essential daily expressions and conversational idioms",
      className: "bg-emerald-50/70 hover:bg-emerald-100 text-emerald-950 border border-emerald-200 text-xs font-semibold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 5,
      onClick: () => {
        handleIncrementActionCount("common_phrases");
        setIsActionsPanelOpen(false);
        onSendMessage(`What are the top 5 most useful conversational phrases and idioms in ${targetLanguage}?`);
        scrollToBottom("smooth");
        focusInput();
      }
    },
    {
      id: "translate_contrast",
      label: "Translate & Compare",
      category: "writing" as const,
      categoryLabel: "Writing",
      icon: <Languages className="w-4 h-4 text-purple-600" />,
      title: "Translate & Contrast",
      description: "Compare nuances between native phrasing and target language",
      className: "bg-purple-50/70 hover:bg-purple-100 text-purple-950 border border-purple-200 text-xs font-semibold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 6,
      onClick: () => {
        handleIncrementActionCount("translate_contrast");
        setIsActionsPanelOpen(false);
        onSendMessage(`How do I express feelings and thoughts naturally in ${targetLanguage} compared to ${nativeLanguage}? Give 3 clear side-by-side examples.`);
        scrollToBottom("smooth");
        focusInput();
      }
    },
    {
      id: "new_chat",
      label: "Start New Chat",
      category: "chat" as const,
      categoryLabel: "Chat",
      icon: <RotateCcw className="w-4 h-4 text-stone-500" />,
      title: "Start Fresh Chat Session",
      description: "Clear current conversation thread and start fresh",
      className: "bg-white hover:bg-stone-50 text-stone-700 hover:text-stone-900 border border-stone-200 text-xs font-semibold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 7,
      onClick: () => {
        handleIncrementActionCount("new_chat");
        setIsActionsPanelOpen(false);
        onClearHistory();
        scrollToBottom("smooth");
        focusInput();
      }
    }
  ];

  // Sorted quick action items by usage count
  const quickActionItems = [...allQuickActionItems].sort((a, b) => {
    const countA = actionCounts[a.id] || 0;
    const countB = actionCounts[b.id] || 0;
    if (countB !== countA) {
      return countB - countA;
    }
    return a.defaultIndex - b.defaultIndex;
  });

  // Filtered items for the expanded modal grid
  const filteredActionItems = quickActionItems.filter((item) => {
    const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;
    const matchesSearch = actionSearchQuery.trim() === "" || 
      item.title.toLowerCase().includes(actionSearchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(actionSearchQuery.toLowerCase()) ||
      item.label.toLowerCase().includes(actionSearchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const showToast = (msgText: string) => {
    setToast(msgText);
    setTimeout(() => setToast(null), 3000);
  };

  // Helper to auto scroll to bottom
  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior, block: "end" });
    }, 50);
  };

  // Helper to auto scroll to the top of the newly added message
  const scrollToTopOfLatestMessage = (behavior: ScrollBehavior = "smooth") => {
    setTimeout(() => {
      if (latestMessageRef.current) {
        latestMessageRef.current.scrollIntoView({ behavior, block: "start" });
      } else if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: "auto", block: "end" });
      }
    }, 50);
  };

  // Auto scroll to top of message when a new message is added to the conversation
  useEffect(() => {
    if (messages.length > 0) {
      const currentLastId = messages[messages.length - 1].id;
      if (currentLastId !== lastMessageIdRef.current) {
        scrollToTopOfLatestMessage("smooth");
        lastMessageIdRef.current = currentLastId;
      }

      const lastMsg = messages[messages.length - 1];
      const feedbackText = lastMsg.quizSpeechText?.trim();
      const nextQuestionText = lastMsg.nextQuestionSpeechText?.trim();
      const fallbackText = lastMsg.audioWord || feedbackText;

      if (lastMsg.role === "assistant" && (fallbackText || nextQuestionText) && (ttsConfig.autoPlayAudioInQuiz ?? true)) {
        const audioTimer = setTimeout(() => {
          const langCode = getLanguageCode(targetLanguage);

          if (feedbackText && nextQuestionText) {
            speakText(
              feedbackText,
              ttsConfig,
              llmConfig,
              langCode,
              undefined,
              () => {
                // Small gap keeps the sequence natural and prevents overlap.
                setTimeout(() => {
                  speakText(nextQuestionText, ttsConfig, llmConfig, langCode);
                }, 180);
              }
            );
            return;
          }

          if (fallbackText) {
            speakText(fallbackText, ttsConfig, llmConfig, langCode);
          }
        }, 350);
        return () => clearTimeout(audioTimer);
      }
    } else {
      lastMessageIdRef.current = null;
    }
  }, [messages, ttsConfig, llmConfig, targetLanguage]);

  // Auto focus textbox on mount
  useEffect(() => {
    focusInput();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isTyping) return;
    const txt = inputText.trim();
    setInputText("");
    onSendMessage(txt);
    scrollToBottom("smooth");
  };

  const handleSpeak = (textToSpeak: string) => {
    // Strip out Markdown formatting before speaking
    const cleanedText = textToSpeak
      .replace(/\*\*|`/g, "")
      .replace(/###/g, "")
      .replace(/##/g, "");
    speakText(cleanedText, ttsConfig, llmConfig, getLanguageCode(targetLanguage));
  };

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full sm:h-[calc(100vh-180px)] bg-white rounded-none sm:rounded-xl border-0 sm:border border-stone-300 overflow-hidden shadow-none relative" id="chat-container">
      
      {/* Toast Notification Banner */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -20, scale: 0.95 }}
            className="absolute top-3 left-1/2 -translate-x-1/2 z-50 bg-stone-900 text-amber-300 border border-amber-400/40 px-4 py-2 rounded-full text-xs font-bold shadow-lg flex items-center gap-2 pointer-events-none"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Messages Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 chat-message-body" id="chat-messages-body">
        <AnimatePresence initial={false}>
          {messages.map((msg, idx) => {
            const isUser = msg.role === "user";
            const isLatestMessage = idx === messages.length - 1;
            
            const parsedQuizOptions: { label: string; action: string; payload: any }[] = [];
            if (!isUser) {
              const lines = msg.content.split("\n");
              for (const line of lines) {
                const cleanLine = line.trim();
                const match = cleanLine.match(/^\s*(?:\*\*)?\s*([A-E])\s*[\)\.]\s*(?:\*\*)?\s*(.+)$/i);
                if (match) {
                  const optionLabel = cleanLine.replace(/\*\*|`/g, "").trim();
                  const optionText = match[2].replace(/\*\*|`/g, "").trim();
                  parsedQuizOptions.push({
                    label: optionLabel,
                    action: "quiz_answer",
                    payload: { answer: optionText }
                  });
                }
              }
            }

            let actionsList: { label: string; action: string; payload?: any }[] = [];

            if (!isUser) {
              const hasQuizOptions = parsedQuizOptions.length >= 2 && parsedQuizOptions.length <= 5;
              
              if (hasQuizOptions) {
                actionsList = [...parsedQuizOptions];
              } else if (msg.suggestedActions && msg.suggestedActions.length > 0) {
                actionsList = [...msg.suggestedActions];
              }

              // On the latest message, if no quiz options are present, detect if AI asks to move on to the next question
              if (isLatestMessage && !hasQuizOptions) {
                const content = msg.content;
                const hasNextAction = actionsList.some(a => 
                  a.label.toLowerCase().includes("question") || 
                  a.label.toLowerCase().includes("move on") || 
                  a.label.toLowerCase().includes("continue to") || 
                  a.label.toLowerCase().includes("next question")
                );

                if (!hasNextAction) {
                  const questionMatch = content.match(/(?:move\s+on\s+to|continue\s+to|proceed\s+to|shall\s+we\s+(?:move\s+on\s+to|try|start|go\s+to)?)\s*\*{0,2}(Question\s*\d+|the\s+next\s+question)\*{0,2}/i)
                    || content.match(/move\s+on\s+to\s+\*{0,2}(Question\s*\d+)\*{0,2}/i)
                    || content.match(/shall\s+we\s+move\s+on\s+to\s+\*{0,2}(Question\s*\d+)\*{0,2}/i);

                  if (questionMatch) {
                    const qStr = questionMatch[1] ? questionMatch[1].replace(/\*/g, "").trim() : "";
                    const labelText = qStr ? `Move on to ${qStr}` : "Move on to next question";
                    actionsList.push({
                      label: labelText,
                      action: "send_message",
                      payload: { message: labelText }
                    });
                  } else if (
                    content.toLowerCase().includes("move on to") || 
                    content.toLowerCase().includes("shall we move on") || 
                    content.toLowerCase().includes("next question") ||
                    content.toLowerCase().includes("ready for the next")
                  ) {
                    actionsList.push({
                      label: "Move on to next question",
                      action: "send_message",
                      payload: { message: "Move on to next question" }
                    });
                  }
                }
              }

              // Filter actions if this is NOT the latest message in the thread:
              // Hide interactive navigation actions ("send_message", "quiz_answer", "start_quiz") on old messages
              if (!isLatestMessage) {
                actionsList = actionsList.filter(a => a.action === "add_word" || a.action === "select_definition");
              }
            }

            const effectiveActions = actionsList;

            return (
              <motion.div
                key={msg.id}
                ref={isLatestMessage ? latestMessageRef : null}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className={`flex flex-col ${isUser ? "ml-auto" : "mr-auto"}`}
              >
                {/* Message Content Bubble */}
                <div className="space-y-2">
                  <div 
                    className={`p-3.5 rounded-2xl ${
                      isUser 
                        ? "text-stone-900 border border-stone-200 rounded-tr-none shadow-3xs" 
                        : "bg-stone-50 border border-stone-200 text-stone-950 rounded-tl-none"
                    }`}
                    style={isUser ? { backgroundColor: "#E5F1FF" } : undefined}
                  >
                    {/* Format standard Markdown */}
                    {isUser ? (
                      <p className="text-sm sm:text-base leading-relaxed font-medium break-words">{msg.content}</p>
                    ) : (
                      <>
                        <FormattedMessage text={msg.content} />

                        {/* Fixed sentence copy card */}
                        {msg.fixedSentence && (
                          <div className="mt-3 p-3 bg-amber-50/90 border border-amber-200/90 rounded-xl flex items-center justify-between gap-3 shadow-2xs">
                            <div className="min-w-0 flex-1">
                              <span className="text-[10px] font-bold text-amber-900 uppercase tracking-wider block font-mono">
                                Polished Sentence:
                              </span>
                              <p className="text-xs sm:text-sm font-semibold text-stone-900 break-words mt-0.5">
                                "{msg.fixedSentence}"
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                navigator.clipboard.writeText(msg.fixedSentence!);
                                showToast("📋 Copied fixed sentence to clipboard!");
                              }}
                              className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-amber-400 font-bold text-xs rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shrink-0 shadow-2xs hover:scale-105 active:scale-95"
                              title="Copy fixed sentence to clipboard"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Copy</span>
                            </button>
                          </div>
                        )}

                        {/* Image for visual picture questions */}
                        {msg.imageUrl && (
                          <div className="my-2.5 max-w-sm rounded-none border border-stone-200 overflow-hidden bg-stone-100 shadow-2xs">
                            <QuizImage 
                              src={msg.imageUrl} 
                              alt="Quiz visual clue" 
                              word={msg.audioWord || "Quiz clue"} 
                            />
                          </div>
                        )}

                        {/* Audio clip player card for listening questions */}
                        {msg.audioWord && (
                          <div className="bg-amber-50/90 border border-amber-200/90 rounded-xl p-3 sm:p-3.5 my-2.5 flex items-center justify-between gap-3 shadow-2xs">
                            <div className="flex items-center gap-2.5">
                              <button
                                type="button"
                                onClick={() => speakText(msg.audioWord!, ttsConfig, llmConfig, getLanguageCode(targetLanguage))}
                                className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-stone-900 hover:bg-stone-800 text-amber-400 flex items-center justify-center shrink-0 shadow-xs cursor-pointer transition-transform hover:scale-105"
                                title="Play audio clip"
                              >
                                <Volume2 className="w-5 h-5" />
                              </button>
                              <div>
                                <h5 className="text-xs font-bold text-stone-900 uppercase tracking-wider flex items-center gap-1">
                                  <Volume2 className="w-3.5 h-3.5 text-amber-600" />
                                  Audio Clip
                                </h5>
                                <p className="text-[11px] text-stone-600 font-serif italic">
                                  Tap play to listen to the target word
                                </p>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => speakText(msg.audioWord!, ttsConfig, llmConfig, getLanguageCode(targetLanguage))}
                              className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-amber-400 font-bold text-xs rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shrink-0 shadow-2xs"
                            >
                              <Volume2 className="w-3.5 h-3.5" />
                              Play Clip
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* AI Suggested Actions Render */}
                  {!isUser && effectiveActions && effectiveActions.length > 0 && (
                    <div className="flex flex-col gap-1.5 pt-1">
                      {effectiveActions.map((act, aIdx) => {
                        const isNextQ = act.label.toLowerCase().includes("question") || 
                          act.label.toLowerCase().includes("move on") || 
                          act.label.toLowerCase().includes("continue to") ||
                          act.label.toLowerCase().includes("next");

                        return (
                          <button
                            key={aIdx}
                            onClick={() => {
                              if (act.action === "copy_text" || act.action === "copy_sentence") {
                                const textToCopy = act.payload?.text || msg.fixedSentence || "";
                                if (textToCopy) {
                                  navigator.clipboard.writeText(textToCopy);
                                  showToast("📋 Copied fixed sentence to clipboard!");
                                }
                              } else if (act.action === "fix_another") {
                                handleIncrementActionCount("fix_grammar");
                                onFixGrammar();
                              } else if (act.action === "add_word" && act.payload?.word) {
                                handleIncrementActionCount("add_word");
                                onAddWord(act.payload.word, act.payload?.hint);
                              } else if (act.action === "start_quiz") {
                                handleIncrementActionCount("start_quiz");
                                onStartQuiz();
                              } else if (act.action === "quiz_answer" && act.payload?.answer) {
                                onSendMessage(act.payload.answer);
                              } else if (act.action === "select_definition" && act.payload && onSelectDefinition) {
                                onSelectDefinition(act.payload.word, act.payload.senseIndex, act.payload.translation);
                              } else if (act.action === "common_phrases") {
                                handleIncrementActionCount("common_phrases");
                                onClearHistory();
                                onSendMessage(`What are some common idioms and phrases in ${targetLanguage}?`);
                              } else if (act.action === "send_message" && act.payload?.message) {
                                onSendMessage(act.payload.message);
                              }
                              scrollToBottom("smooth");
                            }}
                            className={`flex items-center justify-between text-left text-xs rounded-xl py-2 px-3.5 font-bold transition-all duration-200 hover:scale-[1.01] shadow-2xs cursor-pointer group ${
                              isNextQ
                                ? "bg-stone-900 hover:bg-stone-800 text-white border border-stone-900"
                                : "bg-white hover:bg-stone-50 border border-stone-200 text-stone-900 hover:border-stone-300"
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              {isNextQ ? (
                                <ChevronRight className="w-3.5 h-3.5 text-amber-400" />
                              ) : (
                                <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                              )}
                              {act.label}
                            </span>
                            <ChevronRight className={`w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform ${isNextQ ? "text-stone-300" : "text-stone-400"}`} />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}

          {/* Typing Indicator */}
          {isTyping && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex mr-auto"
            >
              <div className="bg-stone-50 border border-stone-100 p-4 rounded-2xl rounded-tl-none flex items-center gap-1.5 shadow-sm">
                <span className="w-2 h-2 bg-stone-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></span>
                <span className="w-2 h-2 bg-stone-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></span>
                <span className="w-2 h-2 bg-stone-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

      {/* Expanded Quick Actions Panel */}
      <AnimatePresence>
        {isActionsPanelOpen && (
          <motion.div
            initial={{ opacity: 0, y: 15, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 15, scale: 0.98 }}
            transition={{ duration: 0.2 }}
            className="bg-stone-50/95 backdrop-blur-md border-t border-stone-200 p-3.5 space-y-3 z-30 shadow-md"
            id="quick-actions-expanded-panel"
          >
            {/* Header with Search & Close */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-1 border-b border-stone-200/80">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-stone-900 text-amber-400 flex items-center justify-center font-bold text-xs shadow-2xs">
                    ⚡
                  </div>
                  <h4 className="text-xs sm:text-sm font-bold text-stone-900 flex items-center gap-1.5">
                    Quick AI Actions
                    <span className="bg-stone-200 text-stone-700 text-[10px] font-bold px-2 py-0.5 rounded-full font-mono">
                      {quickActionItems.length}
                    </span>
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={() => setIsActionsPanelOpen(false)}
                  className="sm:hidden w-7 h-7 rounded-lg bg-stone-200/70 hover:bg-stone-300 text-stone-700 flex items-center justify-center text-xs transition-colors cursor-pointer"
                  title="Close actions panel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Search Box */}
              <div className="flex items-center gap-2 flex-1 max-w-md">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
                  <input
                    type="text"
                    value={actionSearchQuery}
                    onChange={(e) => setActionSearchQuery(e.target.value)}
                    placeholder="Search actions (e.g. grammar, quiz, topic)..."
                    className="w-full bg-white text-stone-900 text-xs border border-stone-200 focus:border-stone-400 rounded-lg pl-8 pr-7 py-1.5 focus:ring-0 transition-colors font-medium placeholder:text-stone-400"
                  />
                  {actionSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setActionSearchQuery("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-700"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setIsActionsPanelOpen(false)}
                  className="hidden sm:flex w-7 h-7 rounded-lg bg-stone-200/70 hover:bg-stone-300 text-stone-700 items-center justify-center text-xs transition-colors cursor-pointer shrink-0"
                  title="Close actions panel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Category Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-0.5">
              {[
                { id: "all", label: "All Actions" },
                { id: "writing", label: "✍️ Writing & Polish" },
                { id: "study", label: "🧠 Quiz & Study" },
                { id: "vocab", label: "📚 Vocabulary" },
                { id: "chat", label: "💬 Chat Session" }
              ].map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedCategory(cat.id as any)}
                  className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                    selectedCategory === cat.id
                      ? "bg-stone-900 text-white shadow-xs"
                      : "bg-white hover:bg-stone-100 text-stone-600 border border-stone-200/80"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Grid of Action Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 max-h-[220px] overflow-y-auto pr-1">
              {filteredActionItems.length > 0 ? (
                filteredActionItems.map((item) => {
                  const count = actionCounts[item.id] || 0;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={item.onClick}
                      className="bg-white hover:bg-amber-50/50 border border-stone-200 hover:border-amber-300/80 p-2.5 rounded-xl text-left transition-all duration-150 hover:shadow-2xs cursor-pointer group flex flex-col justify-between gap-1.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg bg-stone-100 group-hover:bg-amber-100 flex items-center justify-center shrink-0 transition-colors">
                            {item.icon}
                          </div>
                          <div>
                            <h5 className="text-xs font-bold text-stone-900 group-hover:text-stone-950 flex items-center gap-1">
                              {item.title}
                            </h5>
                            <span className="text-[10px] text-stone-400 font-semibold uppercase tracking-wider block">
                              {item.categoryLabel}
                            </span>
                          </div>
                        </div>

                        {count > 0 && (
                          <span className="bg-stone-100 group-hover:bg-amber-200/80 text-stone-600 group-hover:text-amber-950 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md shrink-0">
                            {count}x
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-stone-500 group-hover:text-stone-700 leading-snug line-clamp-2">
                        {item.description}
                      </p>
                    </button>
                  );
                })
              ) : (
                <div className="col-span-full py-6 text-center text-xs text-stone-500 font-medium">
                  No quick actions found for "{actionSearchQuery}"
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Primary Quick Action Dock */}
      <div className="bg-stone-50/80 border-t border-stone-200 px-2 py-1.5 flex items-center gap-1.5 shrink-0 relative" id="quick-actions-dock">
        <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider shrink-0 ml-1 mr-0.5 select-none hidden sm:inline">
          Quick:
        </span>

        {/* Scroll Left Button */}
        <button
          type="button"
          onClick={() => handleScrollDock("left")}
          className="w-6 h-6 rounded-lg bg-white border border-stone-200 hover:bg-stone-100 text-stone-600 flex items-center justify-center shrink-0 transition-all cursor-pointer shadow-3xs"
          title="Scroll left"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>

        {/* Scrollable Container */}
        <div 
          ref={dockScrollRef}
          className="flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5 px-0.5"
        >
          {quickActionItems.map((item) => {
            const count = actionCounts[item.id] || 0;

            return (
              <button
                key={item.id}
                onClick={item.onClick}
                className={`${item.className} relative group`}
                title={`${item.title}${count > 0 ? ` (Used ${count} time${count === 1 ? '' : 's'})` : ''}`}
                id={`quick-action-btn-${item.id}`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}
        </div>

        {/* Scroll Right Button */}
        <button
          type="button"
          onClick={() => handleScrollDock("right")}
          className="w-6 h-6 rounded-lg bg-white border border-stone-200 hover:bg-stone-100 text-stone-600 flex items-center justify-center shrink-0 transition-all cursor-pointer shadow-3xs"
          title="Scroll right"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>

        {/* Toggle All Actions Panel Button */}
        <button
          type="button"
          onClick={() => setIsActionsPanelOpen(prev => !prev)}
          className={`ml-1 px-2.5 py-1.5 rounded-full text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer shrink-0 shadow-2xs ${
            isActionsPanelOpen
              ? "bg-amber-400 text-stone-950 border-amber-500 shadow-xs"
              : "bg-stone-900 hover:bg-stone-800 text-amber-300 border-stone-900 hover:scale-102"
          }`}
          title="View all quick AI actions in grid"
          id="toggle-quick-actions-grid-btn"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">
            {isActionsPanelOpen ? "Close Grid" : "All Actions"}
          </span>
          <span className="bg-stone-800 text-amber-300 text-[10px] font-mono px-1.5 py-0.2 rounded-full">
            {quickActionItems.length}
          </span>
        </button>
      </div>

      {/* Input Message Footer Form */}
      <form onSubmit={handleSubmit} className="p-3 bg-white border-t border-stone-200 shrink-0">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={isTyping}
            placeholder={`Chat with your AI Coach in ${targetLanguage} or ${nativeLanguage}...`}
            className="flex-1 bg-stone-50 hover:bg-stone-100/50 focus:bg-white text-stone-900 border border-stone-200 focus:border-stone-400 focus:ring-0 rounded-xl px-4 py-3 text-sm sm:text-base transition-colors placeholder:text-stone-400 font-medium"
            id="chat-text-input"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || isTyping}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all shadow-sm shrink-0 ${
              inputText.trim() && !isTyping
                ? "bg-stone-900 hover:bg-stone-800 text-white cursor-pointer hover:scale-102"
                : "bg-stone-100 text-stone-400 cursor-not-allowed"
            }`}
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </form>

    </div>
  );
}
