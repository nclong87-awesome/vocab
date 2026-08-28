import React from "react";
import { Word, LLMConfig } from "../../types";
import { WordImageGallery } from "../common/WordImageGallery";

interface WordAddGalleryPreviewProps {
  word: Partial<Word> & { word: string; definition?: string; context?: string; partOfSpeech?: string; imageUrls?: string[]; imageUrl?: string };
  onImagesChange?: (updatedUrls: string[]) => void;
  llmConfig?: LLMConfig;
  className?: string;
}

export const WordAddGalleryPreview: React.FC<WordAddGalleryPreviewProps> = ({
  word,
  onImagesChange,
  llmConfig,
  className = "",
}) => {
  return (
    <WordImageGallery
      word={word}
      onImagesChange={onImagesChange}
      llmConfig={llmConfig}
      autoLoadInitialImages={true}
      className={`mt-2.5 mb-3 rounded-2xl bg-amber-50/90 border border-amber-200/90 shadow-2xs ${className}`}
      titlePrefix="Candidate Images"
      showAddUrlButton={true}
      minSlots={3}
    />
  );
};

export default WordAddGalleryPreview;
