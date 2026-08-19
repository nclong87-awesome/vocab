import React, { useState, useRef, useEffect, useCallback } from "react";
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
  activeModelInfo?: { provider: string; model: string } | null;
  onCancelTyping?: () => void;
  targetLanguage: string;
  nativeLanguage: string;
  appLanguage?: string;
  onAddWord: (word?: string, hint?: string) => void;
  onAddMultipleWords?: (words: any[]) => void;
  onGenerateByTopic: () => void;
  startPractice: () => void;
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
  onUpdateWords?: (updatedWords: Word[]) => void;
  conversationalState?: string;
  toast?: string | null;
  onToast?: (msg: string) => void;
  onRetryErrorMessage?: (messageId: string) => void;
  onCancelErrorMessage?: (messageId: string) => void;
}

function ChatView({
  messages,
  onSendMessage,
  onClearHistory,
  isTyping,
  activeModelInfo,
  onCancelTyping,
  targetLanguage,
  nativeLanguage,
  appLanguage = "Vietnamese",
  onAddWord,
  onAddMultipleWords,
  onGenerateByTopic,
  startPractice,
  onFixGrammar,
  onViewFlashcard,
  onAnalyzeImageVocab,
  onSuggestCasualReplyPrompt,
  onSuggestCasualReply,
  onSelectDefinition,
  onSwitchProvider,
  ttsConfig,
  llmConfig,
  words,
  onUpdateWords,
  conversationalState = "none",
  toast: externalToast,
  onToast: onExternalToast,
  onRetryErrorMessage,
  onCancelErrorMessage,
}: ChatViewProps) {
  const [inputText, setInputText] = useState("");
  const [selectedImage, setSelectedImage] = useState<{ dataUrl: string; name: string } | null>(null);
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [internalToast, setInternalToast] = useState<string | null>(null);
  const toast = externalToast !== undefined ? externalToast : internalToast;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const latestMessageRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastMessageIdRef = useRef<string | null>(null);

  const focusInput = useCallback(() => {
    // if mobile, skip focusing to avoid keyboard pop-up
    if (/Mobi|Android/i.test(navigator.userAgent)) return;
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  }, []);

  const showToast = useCallback((msgText: string) => {
    if (onExternalToast) {
      onExternalToast(msgText);
    } else {
      setInternalToast(msgText);
      setTimeout(() => setInternalToast(null), 3000);
    }
  }, [onExternalToast]);

  // Helper to auto scroll to bottom
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior, block: "end" });
    }, 50);
  }, []);

  const processImageFile = useCallback((file: File, _defaultName?: string) => {
    if (!file.type.startsWith("image/")) {
      showToast("⚠️ Please select or paste a valid image file (PNG, JPG, WEBP)");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      if (typeof reader.result === "string") {
        const rawDataUrl = reader.result;
        const promptNote = inputText.trim() || undefined;
        try {
          const optimizedDataUrl = await resizeImageDataUrl(rawDataUrl, 1600, 0.85);
          if (conversationalState === "suggesting_reply") {
            onSuggestCasualReply?.(optimizedDataUrl, promptNote || "");
          } else {
            onAnalyzeImageVocab?.(optimizedDataUrl, promptNote);
          }
        } catch (err) {
          if (conversationalState === "suggesting_reply") {
            onSuggestCasualReply?.(rawDataUrl, promptNote || "");
          } else {
            onAnalyzeImageVocab?.(rawDataUrl, promptNote);
          }
        }
        setInputText("");
        setSelectedImage(null);
        scrollToBottom("smooth");
      }
    };
    reader.readAsDataURL(file);
  }, [showToast, conversationalState, inputText, onSuggestCasualReply, onAnalyzeImageVocab, scrollToBottom]);

  const handleImageFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    processImageFile(file);
    e.target.value = "";
  }, [processImageFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processImageFile(file, `Dropped Image (${file.name})`);
    }
  }, [processImageFile]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
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
  }, [processImageFile]);

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
  }, [processImageFile]);

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

  const handleRecordActionUse = useCallback((actionId: string) => {
    setActionLastUsed(prev => {
      const updated = { ...prev, [actionId]: Date.now() };
      try {
        localStorage.setItem("vocab_action_last_used", JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }
      return updated;
    });
  }, []);

  // Helper to auto scroll to the top of the newly added message
  const scrollToTopOfLatestMessage = useCallback((behavior: ScrollBehavior = "smooth") => {
    setTimeout(() => {
      if (latestMessageRef.current) {
        latestMessageRef.current.scrollIntoView({ behavior, block: "start" });
      }
    }, 50);
  }, []);

  // Auto scroll to top of message when a new message is added to the conversation
  useEffect(() => {
    if (messages.length > 0) {
      const currentLastId = messages[messages.length - 1].id;
      if (currentLastId !== lastMessageIdRef.current) {
        scrollToTopOfLatestMessage("smooth");
        lastMessageIdRef.current = currentLastId;
      }

      const lastMsg = messages[messages.length - 1];
      const quizSpeechText = lastMsg.quizSpeechText?.trim();
      const nextQuestionText = lastMsg.nextQuestionSpeechText?.trim();
      const fallbackText = lastMsg.audioWord || quizSpeechText;

      if (lastMsg.role === "assistant" && (fallbackText || nextQuestionText) && (ttsConfig.autoPlayAudioInQuiz ?? true)) {
        const audioTimer = setTimeout(() => {
          const langCode = getLanguageCode(targetLanguage);

          if (quizSpeechText) {
            speakText(
              quizSpeechText,
              ttsConfig,
              llmConfig,
              langCode,
              undefined,
              () => {
                if (nextQuestionText) {
                  setTimeout(() => {
                    speakText(nextQuestionText, ttsConfig, llmConfig, langCode);
                  }, 180);
                }
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
  }, [messages, ttsConfig, llmConfig, targetLanguage, scrollToTopOfLatestMessage]);

  // Auto focus textbox on mount
  useEffect(() => {
    focusInput();
  }, [focusInput]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
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
  }, [conversationalState, selectedImage, inputText, isTyping, onSuggestCasualReply, onAnalyzeImageVocab, onSendMessage, scrollToBottom]);

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
        activeModelInfo={activeModelInfo}
        onCancelTyping={onCancelTyping}
        targetLanguage={targetLanguage}
        nativeLanguage={nativeLanguage}
        appLanguage={appLanguage}
        ttsConfig={ttsConfig}
        llmConfig={llmConfig}
        onSendMessage={onSendMessage}
        onAddWord={onAddWord}
        onAddMultipleWords={onAddMultipleWords}
        onGenerateByTopic={onGenerateByTopic}
        startPractice={startPractice}
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
        words={words}
        onUpdateWords={onUpdateWords}
        onRetryErrorMessage={onRetryErrorMessage}
        onCancelErrorMessage={onCancelErrorMessage}
      />

      {/* Quick Actions Component */}
      <QuickActionsSection
        targetLanguage={targetLanguage}
        nativeLanguage={nativeLanguage}
        appLanguage={appLanguage}
        llmConfig={llmConfig}
        actionLastUsed={actionLastUsed}
        handleRecordActionUse={handleRecordActionUse}
        onSendMessage={onSendMessage}
        onClearHistory={onClearHistory}
        onAddWord={onAddWord}
        onGenerateByTopic={onGenerateByTopic}
        startPractice={startPractice}
        onFixGrammar={onFixGrammar}
        onViewFlashcard={onViewFlashcard}
        onSuggestCasualReplyPrompt={onSuggestCasualReplyPrompt}
        onSwitchProvider={onSwitchProvider}
        showToast={showToast}
        scrollToBottom={scrollToBottom}
        focusInput={focusInput}
        setIsPhotoModalOpen={setIsPhotoModalOpen}
        setSelectedImage={setSelectedImage}
        words={words}
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
        onImageSubmit={(dataUrl, prompt) => {
          if (conversationalState === "suggesting_reply") {
            onSuggestCasualReply?.(dataUrl, prompt || "");
          } else {
            onAnalyzeImageVocab?.(dataUrl, prompt);
          }
          scrollToBottom("smooth");
        }}
        targetLanguage={targetLanguage}
        onToast={showToast}
        modeType={conversationalState === "suggesting_reply" ? "reply" : "vocab"}
      />
    </div>
  );
}

export default React.memo(ChatView);
