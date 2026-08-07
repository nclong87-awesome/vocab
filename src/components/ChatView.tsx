import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Send, Sparkles, Volume2, 
  ChevronRight, Check, Copy,
  LayoutGrid, X, Search,
  Camera, Image as _ImageIcon, Upload, ArrowUpDown, Clock
} from "lucide-react";
import { ChatMessage, LLMConfig, TTSConfig, Word, LLMProvider } from "../types";
import { speakText, getLanguageCode } from "../utils/ttsService";
import { resizeImageDataUrl } from "../utils/llmHelpers";
import FormattedMessage from "./chat/FormattedMessage";
import QuizImage from "./quiz/QuizImage";
import PhotoCaptureModal from "./chat/PhotoCaptureModal";
import FlashcardMessageCard from "./chat/FlashcardMessageCard";
import { QuickActionsModelConfig, getQuickActionItems, getRotatedDefaultModel } from "./chat/quickActionsConfig";

interface ChatViewProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => Promise<void>;
  onClearHistory: () => void;
  isTyping: boolean;
  targetLanguage: string;
  nativeLanguage: string;
  onAddWord: (word?: string, hint?: string) => void;
  onAddMultipleWords?: (words: any[]) => void;
  onGenerateByTopic: () => void;
  onStartQuiz: () => void;
  onFixGrammar: () => void;
  onViewFlashcard?: () => void;
  onAnalyzeImageVocab?: (imageDataUrl: string, prompt?: string) => void;
  onSuggestCasualReplyPrompt?: () => void;
  onSuggestCasualReply?: (imageDataUrl: string | null, customPrompt: string) => Promise<void>;
  onSelectDefinition?: (word: string, senseIndex: number, translation: string) => void;
  onSwitchProvider?: (provider: LLMProvider, model?: string) => void;
  ttsConfig: TTSConfig;
  llmConfig: LLMConfig;
  words: Word[];
  conversationalState?: string;
}

export default function ChatView({
  messages,
  onSendMessage,
  onClearHistory,
  isTyping,
  targetLanguage,
  nativeLanguage,
  onAddWord,
  onAddMultipleWords,
  onGenerateByTopic,
  onStartQuiz,
  onFixGrammar,
  onViewFlashcard,
  onAnalyzeImageVocab,
  onSuggestCasualReplyPrompt,
  onSuggestCasualReply,
  onSelectDefinition,
  onSwitchProvider,
  ttsConfig,
  llmConfig,
  conversationalState = "none",
}: ChatViewProps) {
  const [inputText, setInputText] = useState("");
  const [selectedImage, setSelectedImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isActionsPanelOpen, setIsActionsPanelOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<"all" | "writing" | "study" | "vocab" | "chat">("all");
  const [actionSearchQuery, setActionSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<"most_used" | "default">("most_used");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const latestMessageRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dockScrollRef = useRef<HTMLDivElement>(null);

  const focusInput = () => {
    // if mobile, skip focusing to avoid keyboard pop-up
    if (/Mobi|Android/i.test(navigator.userAgent)) return;
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  };

  const processImageFile = async (file: File, defaultName?: string) => {
    if (!file.type.startsWith("image/")) {
      showToast("⚠️ Please select or paste a valid image file (PNG, JPG, WEBP)");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === "string") {
        const name = defaultName || file.name || "Attached Photo";
        const rawDataUrl = reader.result;
        
        // Compress / resize large images to max 1600px dimension for fast & reliable AI Vision analysis
        try {
          const optimizedDataUrl = await resizeImageDataUrl(rawDataUrl, 1600, 0.85);
          setSelectedImage({
            dataUrl: optimizedDataUrl,
            name
          });
        } catch (err) {
          setSelectedImage({
            dataUrl: rawDataUrl,
            name
          });
        }
        showToast("📷 Image attached! Click Send or press Enter to analyze with AI Vision.");
      }
    };
    reader.readAsDataURL(file);
  };

  const handleImageFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processImageFile(file);
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processImageFile(file, `Dropped Image (${file.name})`);
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          processImageFile(file, `Pasted Image (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`);
        }
        break;
      }
    }
  };

  // Listen for global window paste events when chat is active
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            processImageFile(file, `Pasted Image (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`);
          }
          break;
        }
      }
    };

    window.addEventListener("paste", handleGlobalPaste);
    return () => {
      window.removeEventListener("paste", handleGlobalPaste);
    };
  }, []);

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

  const handleResetActionCounts = () => {
    setActionCounts({});
    try {
      localStorage.removeItem("vocab_action_usage_counts");
    } catch (e) {
      console.error(e);
    }
    showToast("🧹 Quick action usage counters reset!");
  };

  // Ordered quick action items with categories, descriptions, and icons sourced from quickActionsConfig
  const allQuickActionItems = getQuickActionItems().map((item) => ({
    ...item,
    onClick: () => {
      handleIncrementActionCount(item.id);
      if (item.id !== "suggest_reply") {
        setSelectedImage(null);
      }

      // Check default models for quick action and set active model for session with rotation if available & not locked
      if (llmConfig?.provider !== "auto" && item.defaultModels && item.defaultModels.length > 0) {
        const match = getRotatedDefaultModel(item.defaultModels);
        if (match) {
          if (onSwitchProvider) {
            onSwitchProvider(match.provider, match.model);
            showToast(`🔄 Rotated session model to ${match.provider.toUpperCase()}: ${match.model}`);
          }
        }
      }

      item.getAction({
        targetLanguage,
        nativeLanguage,
        onFixGrammar,
        onStartQuiz,
        onGenerateByTopic,
        onAddWord,
        onSendMessage,
        onClearHistory,
        onViewFlashcard,
        onSuggestCasualReplyPrompt: () => {
          setIsPhotoModalOpen(true);
          onSuggestCasualReplyPrompt?.();
        },
      });
      setIsActionsPanelOpen(false);
      scrollToBottom("smooth");
      focusInput();
    }
  }));

  // Sorted quick action items by usage count or default index
  const quickActionItems = [...allQuickActionItems].sort((a, b) => {
    if (sortMode === "most_used") {
      const countA = actionCounts[a.id] || 0;
      const countB = actionCounts[b.id] || 0;
      if (countB !== countA) {
        return countB - countA;
      }
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
    if (conversationalState === "suggesting_reply") {
      const imgData = selectedImage ? selectedImage.dataUrl : null;
      const promptText = inputText.trim();
      if (!imgData && !promptText) return;
      setSelectedImage(null);
      setInputText("");
      if (onSuggestCasualReply) {
        onSuggestCasualReply(imgData, promptText);
      }
      scrollToBottom("smooth");
      return;
    }

    if (selectedImage && onAnalyzeImageVocab) {
      const imgData = selectedImage.dataUrl;
      const promptText = inputText.trim();
      setSelectedImage(null);
      setInputText("");
      onAnalyzeImageVocab(imgData, promptText);
      scrollToBottom("smooth");
      return;
    }

    if (!inputText.trim() || isTyping) return;
    const txt = inputText.trim();
    setInputText("");
    onSendMessage(txt);
    scrollToBottom("smooth");
  };


  return (
    <div 
      className="flex flex-col flex-1 min-h-0 h-full bg-stone-50/10 rounded-none sm:rounded-2xl border border-stone-200/80 overflow-hidden shadow-sm relative" 
      id="chat-container"
      onDragOver={handleDragOver}
      onDragEnter={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPaste={handlePaste}
    >
      
      {/* Drag & Drop Visual Overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="absolute inset-0 z-50 bg-blue-900/65 backdrop-blur-xs border-2 border-dashed border-blue-400 rounded-xl flex flex-col items-center justify-center text-white p-6 text-center space-y-3 pointer-events-none"
          >
            <div className="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center shadow-lg animate-bounce">
              <Upload className="w-8 h-8 text-white" />
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-bold">Drop Image to Extract Vocabulary</h3>
              <p className="text-xs text-blue-100 max-w-xs font-medium">
                Gemini Vision will analyze the image and extract key vocabulary items in {targetLanguage}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-stone-50/50 chat-message-body" id="chat-messages-body">
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
                actionsList = actionsList.filter(a => a.action === "add_word" || a.action === "select_definition" || a.action === "retry_analyze_image" || a.action === "copy_text" || a.action === "copy_sentence");
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
                className={
                  isUser
                    ? "flex flex-col max-w-[85%] sm:max-w-[75%] w-full ml-auto items-end"
                    : "flex flex-col max-w-full w-full mr-auto items-stretch"
                }
              >
                {/* Message Content Bubble */}
                <div className="space-y-2 w-full flex flex-col">
                  <div 
                    className={
                      msg.flashcardData 
                        ? "w-full"
                        : `p-4 rounded-2xl w-full ${
                            isUser 
                              ? "bg-stone-900 text-white border border-stone-850 rounded-tr-none shadow-xs" 
                              : "bg-white border border-stone-200/60 text-stone-900 rounded-tl-none shadow-3xs"
                          }`
                    }
                  >
                    {/* Format standard Markdown */}
                    {isUser ? (
                      <div className="space-y-2">
                        <p className="text-sm sm:text-base leading-relaxed font-medium break-words text-white">{msg.content}</p>
                        {msg.imageUrl && (
                          <div className="mt-2 max-w-sm rounded-xl overflow-hidden border border-stone-200 bg-stone-900/5 shadow-2xs">
                            <img 
                              src={msg.imageUrl} 
                              alt="Uploaded photo" 
                              className="w-full max-h-64 object-cover rounded-xl"
                            />
                          </div>
                        )}
                      </div>
                    ) : msg.flashcardData ? (
                      <FlashcardMessageCard
                        data={msg.flashcardData}
                        targetLanguage={targetLanguage}
                        nativeLanguage={nativeLanguage}
                        ttsConfig={ttsConfig}
                        llmConfig={llmConfig}
                        provider={msg.provider}
                        model={msg.model}
                        responseTimeMs={msg.responseTimeMs}
                      />
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

                        {/* Suggested replies cards with direct Copy buttons */}
                        {msg.suggestedReplies && msg.suggestedReplies.length > 0 && (
                          <div className="mt-4 space-y-3 border-t border-stone-100 pt-4">
                            <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block font-mono mb-2">
                              Suggested Replies (Quick Copy):
                            </span>
                            <div className="grid grid-cols-1 gap-3">
                              {msg.suggestedReplies.map((rep, idx) => (
                                <div
                                  key={idx}
                                  className="p-3 bg-stone-50/80 hover:bg-stone-50 border border-stone-200/80 rounded-xl flex items-start justify-between gap-3 shadow-2xs transition-colors"
                                >
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <span className="text-[10px] font-extrabold text-violet-700 font-mono bg-violet-100 px-1.5 py-0.5 rounded">
                                        Option {idx + 1}
                                      </span>
                                      {rep.tone && (
                                        <span className="text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200/40 px-1.5 py-0.5 rounded-md">
                                          {rep.tone}
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-sm font-semibold text-stone-900 mt-2 break-words bg-white/70 px-2 py-1.5 border border-stone-100 rounded-lg">
                                      {rep.reply}
                                    </p>
                                    {rep.translation && (
                                      <p className="text-xs text-stone-600 mt-1.5 italic px-1">
                                        {rep.translation}
                                      </p>
                                    )}
                                    {rep.explanation && (
                                      <p className="text-xs text-stone-500 mt-1 px-1 leading-normal">
                                        {rep.explanation}
                                      </p>
                                    )}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      navigator.clipboard.writeText(rep.reply);
                                      showToast("📋 Copied suggestion to clipboard!");
                                    }}
                                    className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white font-bold text-xs rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shrink-0 shadow-2xs hover:scale-102 active:scale-98 mt-1"
                                    title="Copy suggestion to clipboard"
                                  >
                                    <Copy className="w-3.5 h-3.5" />
                                    <span>Copy</span>
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Image for visual picture questions or photo analysis */}
                        {(msg.imageUrl || msg.imageKeyword) && (
                          <div className="my-2.5 max-w-md rounded-xl border border-stone-200 overflow-hidden bg-stone-100 shadow-2xs">
                            {msg.imageUrl && (msg.imageUrl.startsWith("data:") || msg.imageUrl.startsWith("blob:")) ? (
                              <img 
                                src={msg.imageUrl} 
                                alt={msg.audioWord || "Uploaded photo"} 
                                className="w-full max-h-80 object-cover rounded-xl"
                              />
                            ) : (
                              <QuizImage
                                imageKeyword={msg.imageKeyword}
                                alt="Quiz visual clue" 
                                word={msg.audioWord || "Quiz clue"} 
                              />
                            )}
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

                        {/* AI Response Metadata (Provider, Model, Response Time) */}
                        {(msg.provider || msg.model || msg.responseTimeMs !== undefined) && (
                          <div className="mt-3 pt-2 border-t border-stone-100 flex items-center justify-between text-[11px] text-stone-400 font-medium select-none">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {msg.provider && (
                                <span className="capitalize font-semibold text-stone-600 bg-stone-100 px-1.5 py-0.5 rounded text-[10.5px]">
                                  {msg.provider}
                                </span>
                              )}
                              {msg.model && (
                                <span className="font-mono text-[10.5px] text-stone-500">
                                  {msg.model}
                                </span>
                              )}
                            </div>
                            {msg.responseTimeMs !== undefined && (
                              <div className="flex items-center gap-1 text-stone-400 shrink-0 text-[11px] font-mono" title="AI Response Time">
                                <Clock className="w-3 h-3 text-stone-400" />
                                <span>{(msg.responseTimeMs / 1000).toFixed(2)}s</span>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* AI Suggested Actions Render */}
                  {!isUser && effectiveActions && effectiveActions.length > 0 && (
                    <div className="flex flex-col gap-1.5 pt-1 w-full">
                      {effectiveActions.map((act, aIdx) => {
                        const isNextQ = act.action === "send_message" && (
                          act.label.toLowerCase().startsWith("move on") ||
                          act.label.toLowerCase().startsWith("next question") ||
                          act.label.toLowerCase().includes("continue to question")
                        );

                        return (
                          <button
                            key={aIdx}
                            onClick={() => {
                              if (act.action === "copy_text" || act.action === "copy_sentence") {
                                const textToCopy = act.payload?.text || msg.fixedSentence || "";
                                if (textToCopy) {
                                  navigator.clipboard.writeText(textToCopy);
                                  showToast("📋 Copied selection to clipboard!");
                                }
                              } else if (act.action === "suggest_another") {
                                handleIncrementActionCount("suggest_reply");
                                setIsPhotoModalOpen(true);
                                onSuggestCasualReplyPrompt?.();
                              } else if (act.action === "fix_another") {
                                handleIncrementActionCount("fix_grammar");
                                onFixGrammar();
                              } else if (act.action === "confirm_save_word" && act.payload && onAddMultipleWords) {
                                onAddMultipleWords([act.payload]);
                                showToast(`🎉 Added "${act.payload.word}" to collection!`);
                              } else if (act.action === "add_word" && act.payload?.word) {
                                handleIncrementActionCount("add_word");
                                onAddWord(act.payload.word, act.payload?.hint);
                              } else if (act.action === "add_multiplewords" && act.payload?.words && onAddMultipleWords) {
                                onAddMultipleWords(act.payload.words);
                                showToast(`🎉 Added ${act.payload.words.length} vocabulary words to collection!`);
                              } else if (act.action === "start_quiz") {
                                handleIncrementActionCount("start_quiz");
                                onStartQuiz();
                              } else if (act.action === "view_flashcard") {
                                handleIncrementActionCount("view_flashcard");
                                onViewFlashcard?.();
                              } else if (act.action === "quiz_answer" && act.payload?.answer) {
                                onSendMessage(act.payload.answer);
                              } else if (act.action === "select_definition" && act.payload && onSelectDefinition) {
                                onSelectDefinition(act.payload.word, act.payload.senseIndex, act.payload.translation);
                              } else if (act.action === "common_phrases") {
                                handleIncrementActionCount("common_phrases");
                                onClearHistory();
                                onSendMessage(
                                  `I'd like to learn common phrases and idioms in ${targetLanguage} (with ${nativeLanguage} translations).`
                                );
                                scrollToBottom("smooth");
                                focusInput();
                              } else if (act.action === "explain_grammar") {
                                handleIncrementActionCount("explain_grammar");
                                onClearHistory();
                                onSendMessage(
                                  `I'd like to explore grammar rules in ${targetLanguage} (explained in ${nativeLanguage}).`
                                );
                                scrollToBottom("smooth");
                                focusInput();
                              } else if (act.action === "translate_contrast") {
                                handleIncrementActionCount("translate_contrast");
                                onClearHistory();
                                onSendMessage(
                                  `I'd like to translate a phrase and compare nuances between ${nativeLanguage} and ${targetLanguage}.`
                                );
                                scrollToBottom("smooth");
                                focusInput();
                              } else if (act.action === "retry_analyze_image" && onAnalyzeImageVocab) {
                                const imageToRetry = act.payload?.imageDataUrl || [...messages].reverse().find(m => Boolean(m.imageUrl))?.imageUrl;
                                if (imageToRetry) {
                                  showToast("🔄 Retrying photo vocabulary analysis...");
                                  onAnalyzeImageVocab(imageToRetry, act.payload?.customPrompt);
                                } else {
                                  showToast("📷 Please upload or select a photo to analyze");
                                  setIsPhotoModalOpen(true);
                                }
                              } else if (act.action === "send_message" && act.payload?.message) {
                                onSendMessage(act.payload.message);
                              }
                              scrollToBottom("smooth");
                            }}
                            className={`flex items-start justify-between text-left text-xs rounded-xl py-2.5 px-3.5 transition-all duration-200 shadow-2xs cursor-pointer group ${
                              isNextQ
                                ? "bg-stone-900 hover:bg-stone-800 text-white border border-stone-900 font-bold"
                                : "bg-white hover:bg-stone-900 focus:bg-stone-900 active:bg-stone-900 border border-stone-200 hover:border-stone-900 focus:border-stone-900 text-stone-900 hover:text-white focus:text-white"
                            }`}
                          >
                            <div className="flex items-start gap-2.5 min-w-0 flex-1">
                              {isNextQ ? (
                                <ChevronRight className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                              ) : (
                                <Sparkles className="w-3.5 h-3.5 text-amber-500 group-hover:text-amber-400 group-focus:text-amber-400 animate-pulse shrink-0 mt-0.5" />
                              )}

                              {act.action === "select_definition" && act.payload?.definition ? (
                                <div className="flex flex-col gap-1 min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className={`inline-block px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase rounded border shrink-0 transition-colors ${
                                      isNextQ
                                        ? "bg-amber-400 text-stone-950 border-amber-300"
                                        : "bg-amber-100/90 text-amber-900 border-amber-200/70 group-hover:bg-amber-400 group-hover:text-stone-950 group-focus:bg-amber-400 group-focus:text-stone-950 group-active:bg-amber-400 group-active:text-stone-950"
                                    }`}>
                                      {act.payload.partOfSpeech || "sense"}
                                    </span>
                                    <span className={`font-bold text-xs sm:text-sm transition-colors ${
                                      isNextQ
                                        ? "text-white"
                                        : "text-stone-900 group-hover:text-white group-focus:text-white group-active:text-white"
                                    }`}>
                                      {act.payload.targetWord || act.payload.word}
                                      {act.payload.translation && (
                                        <span className={`font-medium ml-1 transition-colors ${
                                          isNextQ
                                            ? "text-stone-300"
                                            : "text-stone-600 group-hover:text-stone-300 group-focus:text-stone-300 group-active:text-stone-300"
                                        }`}>
                                          ({act.payload.translation})
                                        </span>
                                      )}
                                    </span>
                                  </div>
                                  <p className={`text-xs leading-snug font-normal break-words line-clamp-3 transition-colors ${
                                    isNextQ
                                      ? "text-stone-200"
                                      : "text-stone-700 group-hover:text-stone-200 group-focus:text-stone-200 group-active:text-stone-200"
                                  }`}>
                                    {act.payload.definition}
                                  </p>
                                  {act.payload.example && (
                                    <p className={`text-[11px] italic line-clamp-1 mt-0.5 font-normal transition-colors ${
                                      isNextQ
                                        ? "text-amber-200/90"
                                        : "text-stone-500 group-hover:text-amber-200/90 group-focus:text-amber-200/90 group-active:text-amber-200/90"
                                    }`}>
                                      Ex: "{act.payload.example}"
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <span className={`whitespace-normal break-words leading-relaxed font-semibold min-w-0 flex-1 transition-colors ${
                                  isNextQ
                                    ? "text-white"
                                    : "text-stone-900 group-hover:text-white group-focus:text-white group-active:text-white"
                                }`}>
                                  {act.label}
                                </span>
                              )}
                            </div>
                            <ChevronRight className={`w-3.5 h-3.5 group-hover:translate-x-0.5 transition-all shrink-0 mt-1 ml-2 ${
                              isNextQ 
                                ? "text-stone-300" 
                                : "text-stone-400 group-hover:text-white group-focus:text-white group-active:text-white"
                            }`} />
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

            {/* Default AI Model Config Widget for Quick Actions */}
            <QuickActionsModelConfig llmConfig={llmConfig} onToast={showToast} />

            {/* Category Filter Pills & Sort Options */}
            <div className="flex flex-wrap items-center justify-between gap-2 pb-0.5">
              <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-0.5">
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

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSortMode(prev => prev === "most_used" ? "default" : "most_used")}
                  className={`px-2.5 py-1 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer border ${
                    sortMode === "most_used"
                      ? "bg-amber-100 hover:bg-amber-200 text-amber-950 border-amber-300 shadow-2xs"
                      : "bg-white hover:bg-stone-100 text-stone-700 border-stone-200"
                  }`}
                  title={sortMode === "most_used" ? "Sorting by Most Used. Click for Default Order." : "Sorting by Default Order. Click for Most Used."}
                >
                  <ArrowUpDown className="w-3.5 h-3.5" />
                  <span>{sortMode === "most_used" ? "🔥 Sort: Most Used" : "📋 Sort: Default"}</span>
                </button>

                <button
                  type="button"
                  onClick={handleResetActionCounts}
                  className="text-[11px] font-semibold text-stone-500 hover:text-stone-800 hover:bg-stone-200/60 px-2 py-1 rounded-md transition-colors cursor-pointer"
                  title="Reset usage counters for all actions"
                >
                  Reset Counts
                </button>
              </div>
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
                              {item.label}
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
        {/* Attached image preview banner */}
        {selectedImage && (
          <div className="mb-2.5 p-2 bg-amber-50/90 border border-amber-200/80 rounded-xl flex items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <img
                src={selectedImage.dataUrl}
                alt="Upload preview"
                className="w-10 h-10 object-cover rounded-lg border border-amber-300 shrink-0 shadow-2xs"
              />
              <div className="min-w-0">
                <span className="text-xs font-bold text-amber-950 truncate block flex items-center gap-1">
                  <Camera className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  Photo Attached: {selectedImage.name}
                </span>
                <span className="text-[10px] text-amber-800/80 block">
                  {conversationalState === "suggesting_reply"
                    ? "Gemini Vision will analyze the screenshot to suggest casual replies when submitted"
                    : "Gemini Vision will extract & translate vocabulary items when submitted"}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedImage(null)}
              className="p-1 rounded-full bg-amber-200/80 hover:bg-amber-300 text-amber-900 transition-colors cursor-pointer shrink-0"
              title="Remove attached photo"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex gap-2 items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageFileChange}
            className="hidden"
            id="chat-file-input"
          />
          <button
            type="button"
            onClick={() => setIsPhotoModalOpen(true)}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all shrink-0 cursor-pointer shadow-2xs ${
              selectedImage
                ? "bg-amber-400 text-stone-950 shadow-xs scale-102 border border-amber-500/30"
                : "bg-stone-100 hover:bg-stone-200/80 text-stone-700 hover:scale-105"
            }`}
            title="Take a picture, upload photo, or paste image to extract vocabulary with AI Vision"
            id="chat-upload-photo-btn"
          >
            <Camera className="w-5 h-5" />
          </button>

          <input
            ref={inputRef}
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={isTyping}
            placeholder={
              selectedImage
                ? "Add an optional focus note (e.g. 'Focus on food items') or press Enter to analyze..."
                : `Chat or paste an image (Ctrl+V) / pick photo to extract vocabulary...`
            }
            className="flex-1 bg-stone-50 hover:bg-stone-100/50 focus:bg-white text-stone-900 border border-stone-200 focus:border-stone-400 focus:ring-0 rounded-xl px-4 py-3 text-sm sm:text-base transition-colors placeholder:text-stone-400 font-medium"
            id="chat-text-input"
          />
          <button
            type="submit"
            disabled={(!inputText.trim() && !selectedImage) || isTyping}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all shadow-sm shrink-0 ${
              (inputText.trim() || selectedImage) && !isTyping
                ? "bg-stone-900 hover:bg-stone-800 text-white cursor-pointer hover:scale-102"
                : "bg-stone-100 text-stone-400 cursor-not-allowed"
            }`}
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </form>

      {/* Photo Capture & Upload Modal */}
      <PhotoCaptureModal
        isOpen={isPhotoModalOpen}
        onClose={() => setIsPhotoModalOpen(false)}
        onImageSelected={(dataUrl, name) => {
          setSelectedImage({ dataUrl, name });
          showToast("📷 Photo attached! Click Send or press Enter to analyze with AI Vision.");
        }}
        targetLanguage={targetLanguage}
        onToast={showToast}
      />
    </div>
  );
}
