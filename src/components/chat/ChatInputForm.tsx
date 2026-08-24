import React, { useState, useRef, useCallback } from "react";
import { Camera, Mic, MicOff, Send, X } from "lucide-react";
import { useSpeechToText } from "../../hooks/useSpeechToText";
import { getLanguageCode } from "../../utils/ttsService";

interface ChatInputFormProps {
  inputText: string;
  setInputText: (text: string) => void;
  selectedImage: { dataUrl: string; name: string } | null;
  setSelectedImage: (img: { dataUrl: string; name: string } | null) => void;
  isPhotoModalOpen: boolean;
  setIsPhotoModalOpen: (open: boolean) => void;
  isTyping: boolean;
  conversationalState: string;
  targetLanguage: string;
  nativeLanguage?: string;
  showToast: (msg: string) => void;
  handleSubmit: (e: React.FormEvent) => void;
  handleImageFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

function ChatInputForm({
  inputText,
  setInputText,
  selectedImage,
  setSelectedImage,
  setIsPhotoModalOpen,
  isTyping,
  conversationalState,
  targetLanguage,
  nativeLanguage,
  showToast,
  handleSubmit,
  handleImageFileChange,
  fileInputRef,
  inputRef,
}: ChatInputFormProps) {
  const baseTextRef = useRef("");
  // Default to native language as requested
  const [speechLangMode, setSpeechLangMode] = useState<"native" | "target">("native");

  const effectiveNative = nativeLanguage || "Vietnamese";
  const effectiveTarget = targetLanguage || "English";
  const currentSpeechLang = speechLangMode === "native" ? effectiveNative : effectiveTarget;
  const alternateSpeechLang = speechLangMode === "native" ? effectiveTarget : effectiveNative;

  const handleTranscript = useCallback((transcript: string) => {
    const base = baseTextRef.current.trim();
    const cleanTranscript = transcript.trim();
    const updated = base ? `${base} ${cleanTranscript}` : cleanTranscript;
    setInputText(updated);
  }, [setInputText]);

  const handleSpeechError = useCallback((errMsg: string) => {
    showToast(errMsg);
  }, [showToast]);

  const {
    isSupported,
    isListening,
    startListening,
    stopListening,
  } = useSpeechToText({
    language: currentSpeechLang,
    onTranscript: handleTranscript,
    onError: handleSpeechError,
  });

  const handleMicClick = useCallback(() => {
    if (!isSupported) {
      showToast("⚠️ Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.");
      return;
    }

    if (isListening) {
      stopListening();
    } else {
      baseTextRef.current = inputText;
      // Request mic permission and start recognition upon this explicit user click
      startListening(getLanguageCode(currentSpeechLang));
    }
  }, [isSupported, isListening, inputText, currentSpeechLang, startListening, stopListening, showToast]);

  const onFormSubmit = useCallback((e: React.FormEvent) => {
    if (isListening) {
      stopListening();
    }
    handleSubmit(e);
  }, [isListening, stopListening, handleSubmit]);

  return (
    <form onSubmit={onFormSubmit} className="p-3 bg-white border-t border-stone-200 shrink-0">
      {/* Live Voice Recording Status Bar */}
      {isListening && (
        <div className="mb-2.5 p-2 px-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center justify-between gap-2 shadow-2xs animate-fadeIn">
          <div className="flex items-center gap-2 min-w-0">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
            </span>
            <span className="text-xs font-semibold text-rose-900 truncate">
              Listening in <strong className="font-bold">{currentSpeechLang}</strong>... Speak now
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {effectiveNative.toLowerCase() !== effectiveTarget.toLowerCase() && (
              <button
                type="button"
                onClick={() => {
                  const newMode = speechLangMode === "native" ? "target" : "native";
                  setSpeechLangMode(newMode);
                  const nextLang = newMode === "native" ? effectiveNative : effectiveTarget;
                  baseTextRef.current = inputText;
                  stopListening();
                  setTimeout(() => {
                    startListening(getLanguageCode(nextLang));
                  }, 120);
                }}
                className="text-[11px] font-medium px-2 py-0.5 rounded-lg bg-white border border-rose-200 text-rose-700 hover:bg-rose-100 cursor-pointer transition-colors"
                title={`Switch speech language to ${alternateSpeechLang}`}
              >
                Switch to {alternateSpeechLang}
              </button>
            )}
            <button
              type="button"
              onClick={stopListening}
              className="text-[11px] font-bold px-2.5 py-0.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white cursor-pointer transition-colors shadow-2xs"
            >
              Done
            </button>
          </div>
        </div>
      )}

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

      <div
        className={`flex items-center gap-1 sm:gap-2 px-2 py-1.5 sm:px-2.5 sm:py-2 rounded-full border transition-all shadow-2xs ${
          isListening
            ? "bg-rose-50/70 border-rose-300 ring-2 ring-rose-200"
            : "bg-stone-50 hover:bg-stone-100/70 focus-within:bg-white border-stone-200 focus-within:border-stone-400 focus-within:ring-2 focus-within:ring-stone-400/20"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageFileChange}
          className="hidden"
          id="chat-file-input"
        />

        {/* Embedded Chat Text Input (Left & Center) */}
        <input
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          disabled={isTyping}
          placeholder={
            isListening
              ? `Listening in ${currentSpeechLang}... (speak now)`
              : conversationalState === "confirming_add_word"
              ? "Type 'confirm' to add word, or 'cancel'..."
              : conversationalState === "adding_word"
              ? "Type another word to add, or ask a question..."
              : selectedImage
              ? "Add an optional focus note (e.g. 'Focus on food items')..."
              : `Ask anything or practice vocabulary...`
          }
          className="flex-1 bg-transparent border-0 outline-none focus:outline-none focus:ring-0 px-3 py-1.5 text-sm sm:text-base text-stone-900 placeholder:text-stone-400 font-medium min-w-0"
          id="chat-text-input"
        />

        {/* Embedded Camera / Photo Button (Right, next to Mic) */}
        <button
          type="button"
          onClick={() => setIsPhotoModalOpen(true)}
          className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all shrink-0 cursor-pointer ${
            selectedImage
              ? "bg-amber-400 text-stone-950 shadow-xs scale-105"
              : "text-stone-500 hover:text-stone-900 hover:bg-stone-200/70 active:scale-95"
          }`}
          title="Take a picture, upload photo, or paste image to extract vocabulary"
          id="chat-upload-photo-btn"
        >
          <Camera className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>

        {/* Embedded Speech-to-Text Mic Button (Right, next to Camera) */}
        <button
          type="button"
          onClick={handleMicClick}
          disabled={isTyping}
          className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all shrink-0 cursor-pointer ${
            isListening
              ? "bg-rose-600 hover:bg-rose-700 text-white ring-2 ring-rose-300 scale-105 animate-pulse shadow-2xs"
              : "text-stone-500 hover:text-stone-900 hover:bg-stone-200/70 active:scale-95"
          }`}
          title={
            isListening
              ? "Listening... Click to finish speaking"
              : `Voice input (Web Speech-to-Text in ${currentSpeechLang})`
          }
          id="chat-voice-input-btn"
        >
          {isListening ? (
            <MicOff className="w-4 h-4 sm:w-5 sm:h-5" />
          ) : (
            <Mic className="w-4 h-4 sm:w-5 sm:h-5" />
          )}
        </button>

        {/* Embedded Send Button (Right) */}
        <button
          type="submit"
          disabled={(!inputText.trim() && !selectedImage) || isTyping}
          className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full flex items-center justify-center transition-all shrink-0 ${
            (inputText.trim() || selectedImage) && !isTyping
              ? "bg-stone-900 hover:bg-stone-800 text-white cursor-pointer hover:scale-105 active:scale-95 shadow-xs"
              : "text-stone-300 cursor-not-allowed opacity-40"
          }`}
          title="Send message"
          id="chat-send-btn"
        >
          <Send className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
        </button>
      </div>
    </form>
  );
}

export default React.memo(ChatInputForm);

