import React from "react";
import { Camera, Send, X } from "lucide-react";

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
  handleSubmit,
  handleImageFileChange,
  fileInputRef,
  inputRef,
}: ChatInputFormProps) {
  return (
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
            conversationalState === "confirming_add_word"
              ? "Type 'confirm' to add word, or 'cancel'..."
              : conversationalState === "adding_word"
              ? "Type another word or expression to add..."
              : selectedImage
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
  );
}

export default React.memo(ChatInputForm);
