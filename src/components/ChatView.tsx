import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Send, Sparkles, Trash2, Plus, Volume2, Bot, User, 
  Brain, BookOpen, AlertCircle, HelpCircle, ChevronRight, Check, CheckSquare, RotateCcw
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const latestMessageRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const focusInput = () => {
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
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

  // Ordered quick action items according to most used
  const quickActionItems = [
    {
      id: "fix_grammar",
      label: "Fix Grammar & Polish",
      icon: <CheckSquare className="w-3.5 h-3.5 text-amber-600" />,
      title: "Fix grammar & spelling, improve clarity and readability",
      className: "bg-amber-50 hover:bg-amber-100 text-amber-950 border border-amber-300/80 text-xs font-bold py-1.5 px-3 rounded-full shadow-xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 0,
      onClick: () => {
        handleIncrementActionCount("fix_grammar");
        onFixGrammar();
        scrollToBottom("smooth");
        focusInput();
      }
    },
    {
      id: "start_quiz",
      label: "Start Today's Quiz",
      icon: <Brain className="w-3.5 h-3.5" />,
      title: "Start daily interactive quiz",
      className: "bg-stone-900 hover:bg-stone-800 text-white text-xs font-bold py-1.5 px-3 rounded-full shadow-sm transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 1,
      onClick: () => {
        handleIncrementActionCount("start_quiz");
        onStartQuiz();
        scrollToBottom("smooth");
        focusInput();
      }
    },
    {
      id: "generate_topic",
      label: "Generate by Topic",
      icon: <Sparkles className="w-3.5 h-3.5 text-amber-500" />,
      title: "Generate words around a topic",
      className: "bg-white hover:bg-stone-50 text-stone-900 border border-stone-200 text-xs font-bold py-1.5 px-3 rounded-full shadow-xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 2,
      onClick: () => {
        handleIncrementActionCount("generate_topic");
        onGenerateByTopic();
        scrollToBottom("smooth");
        focusInput();
      }
    },
    {
      id: "add_word",
      label: "Add Word",
      icon: <Plus className="w-3.5 h-3.5 text-stone-600" />,
      title: "Add a word to collection",
      className: "bg-white hover:bg-stone-50 text-stone-900 border border-stone-200 text-xs font-bold py-1.5 px-3 rounded-full shadow-xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 3,
      onClick: () => {
        handleIncrementActionCount("add_word");
        onAddWord();
        scrollToBottom("smooth");
        focusInput();
      }
    },
    {
      id: "common_phrases",
      label: "Common Phrases",
      icon: <HelpCircle className="w-3.5 h-3.5 text-stone-500" />,
      title: "Learn common useful phrases",
      className: "bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-semibold py-1.5 px-3 rounded-full transition-all cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 4,
      onClick: () => {
        handleIncrementActionCount("common_phrases");
        onClearHistory();
        onSendMessage(`What are the top 5 most common useful phrases in ${targetLanguage}?`);
        scrollToBottom("smooth");
        focusInput();
      }
    },
    {
      id: "new_chat",
      label: "Start new chat",
      icon: <RotateCcw className="w-3.5 h-3.5 text-stone-500" />,
      title: "Start a fresh chat conversation",
      className: "bg-white hover:bg-stone-50 text-stone-700 hover:text-stone-900 border border-stone-200 text-xs font-semibold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: 5,
      onClick: () => {
        handleIncrementActionCount("new_chat");
        onClearHistory();
        scrollToBottom("smooth");
        focusInput();
      }
    }
  ].sort((a, b) => {
    const countA = actionCounts[a.id] || 0;
    const countB = actionCounts[b.id] || 0;
    if (countB !== countA) {
      return countB - countA;
    }
    return a.defaultIndex - b.defaultIndex;
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

  // Auto focus textbox on mount and when typing finishes
  useEffect(() => {
    focusInput();
  }, []);

  useEffect(() => {
    if (!isTyping) {
      focusInput();
    }
  }, [isTyping]);

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

      {/* Quick Action Dock - Sorted by Most Used */}
      <div className="bg-stone-50/50 border-t border-stone-200 px-3 py-2 flex items-center gap-2 overflow-x-auto scrollbar-none shrink-0" id="quick-actions-dock">
        <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider shrink-0 mr-1 select-none">Quick:</span>
        
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
