import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Sparkles, Upload } from "lucide-react";
import { ChatMessage, LLMConfig, TTSConfig, Word, LLMProvider } from "../types";
import { speakText, getLanguageCode } from "../utils/ttsService";
import { resizeImageDataUrl } from "../utils/llmHelpers";
import PhotoCaptureModal from "./chat/PhotoCaptureModal";
import MessageList from "./chat/MessageList";
import QuickActionsSection from "./chat/QuickActionsSection";
import ChatInputForm from "./chat/ChatInputForm";

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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const latestMessageRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastMessageIdRef = useRef<string | null>(null);

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

  // Quick Actions Last Used Timestamps (persisted in localStorage)
  const [actionLastUsed, setActionLastUsed] = useState<Record<string, number>>(() => {
    try {
      const stored = localStorage.getItem("vocab_action_last_used");
      if (stored) return JSON.parse(stored);
    } catch (e) {
      console.error(e);
    }
    return {};
  });

  const handleRecordActionUse = (actionId: string) => {
    setActionLastUsed(prev => {
      const updated = { ...prev, [actionId]: Date.now() };
      try {
        localStorage.setItem("vocab_action_last_used", JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }
      return updated;
    });
  };

  const handleResetActionLastUsed = () => {
    setActionLastUsed({});
    try {
      localStorage.removeItem("vocab_action_last_used");
    } catch (e) {
      console.error(e);
    }
    showToast("🧹 Quick action order reset!");
  };

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
                AI Vision will analyze the image and extract key vocabulary items in {targetLanguage}
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
      <MessageList
        messages={messages}
        isTyping={isTyping}
        targetLanguage={targetLanguage}
        nativeLanguage={nativeLanguage}
        ttsConfig={ttsConfig}
        llmConfig={llmConfig}
        onSendMessage={onSendMessage}
        onClearHistory={onClearHistory}
        onAddWord={onAddWord}
        onAddMultipleWords={onAddMultipleWords}
        onStartQuiz={onStartQuiz}
        onFixGrammar={onFixGrammar}
        onViewFlashcard={onViewFlashcard}
        onAnalyzeImageVocab={onAnalyzeImageVocab}
        onSuggestCasualReplyPrompt={onSuggestCasualReplyPrompt}
        onSuggestCasualReply={onSuggestCasualReply}
        onSelectDefinition={onSelectDefinition}
        showToast={showToast}
        scrollToBottom={scrollToBottom}
        focusInput={focusInput}
        setIsPhotoModalOpen={setIsPhotoModalOpen}
        handleRecordActionUse={handleRecordActionUse}
        messagesEndRef={messagesEndRef}
        latestMessageRef={latestMessageRef}
      />

      {/* Quick Actions Component */}
      <QuickActionsSection
        targetLanguage={targetLanguage}
        nativeLanguage={nativeLanguage}
        llmConfig={llmConfig}
        actionLastUsed={actionLastUsed}
        handleRecordActionUse={handleRecordActionUse}
        handleResetActionLastUsed={handleResetActionLastUsed}
        onSendMessage={onSendMessage}
        onClearHistory={onClearHistory}
        onAddWord={onAddWord}
        onStartQuiz={onStartQuiz}
        onFixGrammar={onFixGrammar}
        onViewFlashcard={onViewFlashcard}
        onSuggestCasualReplyPrompt={onSuggestCasualReplyPrompt}
        onSwitchProvider={onSwitchProvider}
        showToast={showToast}
        scrollToBottom={scrollToBottom}
        focusInput={focusInput}
        setIsPhotoModalOpen={setIsPhotoModalOpen}
        setSelectedImage={setSelectedImage}
      />

      {/* Input Message Footer Form */}
      <ChatInputForm
        inputText={inputText}
        setInputText={setInputText}
        selectedImage={selectedImage}
        setSelectedImage={setSelectedImage}
        isPhotoModalOpen={isPhotoModalOpen}
        setIsPhotoModalOpen={setIsPhotoModalOpen}
        isTyping={isTyping}
        conversationalState={conversationalState}
        targetLanguage={targetLanguage}
        showToast={showToast}
        handleSubmit={handleSubmit}
        handleImageFileChange={handleImageFileChange}
        fileInputRef={fileInputRef}
        inputRef={inputRef}
      />

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
