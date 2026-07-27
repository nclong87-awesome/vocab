import React from "react";
import { Sparkles, Plus } from "lucide-react";
import { LLMConfig, LLMProvider } from "../../types";
import QuickAiSwitcher from "../layout/QuickAiSwitcher";

interface AiDeckGeneratorProps {
  targetLanguage: string;
  setTargetLanguage: (lang: string) => void;
  nativeLanguage: string;
  setNativeLanguage: (lang: string) => void;
  quantity: number;
  setQuantity: (q: number) => void;
  customTopic: string;
  setCustomTopic: (topic: string) => void;
  onSubmitCustomTopic: (e: React.FormEvent) => void;
  onPresetClick: (topic: string) => void;
  isLoading: boolean;
  languages: Array<{ code: string; name: string }>;
  presetTopics: Array<{ label: string; emoji: string; topic: string }>;
  llmConfig?: LLMConfig;
  onSwitchProvider?: (providerId: LLMProvider, modelOverride?: string) => void;
  onOpenLlmModal?: (providerId?: LLMProvider) => void;
}

export default function AiDeckGenerator({
  targetLanguage,
  setTargetLanguage,
  nativeLanguage,
  setNativeLanguage,
  quantity,
  setQuantity,
  customTopic,
  setCustomTopic,
  onSubmitCustomTopic,
  onPresetClick,
  isLoading,
  languages,
  presetTopics,
  llmConfig,
  onSwitchProvider,
  onOpenLlmModal
}: AiDeckGeneratorProps) {
  return (
    <div 
      className="bg-white border border-stone-200 p-4 sm:p-8 space-y-5 sm:space-y-8 sticky top-6"
      id="ai-deck-builder"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-stone-100">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-stone-50 text-stone-900 border border-stone-200">
            <Sparkles className="w-5 h-5 text-amber-500" />
          </div>
          <div>
            <h3 className="font-bold text-sm text-stone-950">AI Deck Generator</h3>
            <p className="text-xs text-stone-500 font-medium mt-0.5">Instant AI vocabulary curation</p>
          </div>
        </div>

        {llmConfig && onSwitchProvider && onOpenLlmModal && (
          <QuickAiSwitcher 
            llmConfig={llmConfig}
            onSwitchProvider={onSwitchProvider}
            onOpenLlmModal={onOpenLlmModal}
            compact
          />
        )}
      </div>

      {/* Language Selection */}
      <div className="grid grid-cols-2 gap-4 text-xs font-semibold">
        <div>
          <label className="block text-stone-600 mb-1.5">Target Language</label>
          <select 
            value={targetLanguage} 
            onChange={(e) => setTargetLanguage(e.target.value)}
            className="w-full border border-stone-200 bg-stone-50 px-3 py-2.5 font-bold text-stone-800 outline-none focus:border-stone-950 focus:bg-white transition-all cursor-pointer text-xs"
            id="select-target-lang"
          >
            {languages.map(lang => (
              <option key={lang.code} value={lang.code}>{lang.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-stone-600 mb-1.5">Native Language</label>
          <select 
            value={nativeLanguage} 
            onChange={(e) => setNativeLanguage(e.target.value)}
            className="w-full border border-stone-200 bg-stone-50 px-3 py-2.5 font-bold text-stone-800 outline-none focus:border-stone-950 focus:bg-white transition-all cursor-pointer text-xs"
            id="select-native-lang"
          >
            {languages.map(lang => (
              <option key={lang.code} value={lang.code}>{lang.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Quantity */}
      <div className="text-xs font-semibold">
        <label className="block text-stone-600 mb-1.5">Deck Size</label>
        <div className="flex gap-2">
          {[5, 8, 12].map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => setQuantity(num)}
              className={`flex-1 py-2 border text-center font-semibold transition-all text-xs cursor-pointer ${
                quantity === num 
                  ? "border-stone-950 bg-stone-950 text-white" 
                  : "border-stone-200 bg-stone-50 text-stone-600 hover:border-stone-400 hover:text-stone-900"
              }`}
            >
              {num} Words
            </button>
          ))}
        </div>
      </div>

      {/* Custom Topic Form */}
      <form onSubmit={onSubmitCustomTopic} className="space-y-3">
        <div className="text-xs font-semibold">
          <label className="block text-stone-600 mb-1.5">Custom Topic</label>
          <div className="relative">
            <input
              type="text"
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              placeholder="e.g., Medical jargon, Bakery terminology"
              className="w-full border border-stone-200 bg-stone-50 pl-3 pr-12 py-3 font-semibold text-stone-800 outline-none focus:border-stone-950 focus:bg-white transition-all text-xs"
              id="input-custom-topic"
            />
            <button
              type="submit"
              disabled={!customTopic.trim() || isLoading}
              className="absolute right-1.5 top-1.5 p-2 bg-stone-900 hover:bg-black disabled:bg-stone-100 disabled:text-stone-300 text-white transition-colors cursor-pointer"
              id="btn-submit-topic"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </div>
      </form>

      {/* Preset Topics */}
      <div className="space-y-3">
        <label className="block text-xs font-semibold text-stone-600">Or Select a Preset Theme</label>
        <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1" id="presets-container">
          {presetTopics.map((preset, idx) => (
            <button
              key={idx}
              onClick={() => onPresetClick(preset.label)}
              disabled={isLoading}
              className="w-full text-left p-4 border border-stone-100 bg-stone-50 hover:bg-stone-100 hover:border-stone-300 transition-all flex items-start gap-4 cursor-pointer group"
            >
              <span className="text-xl bg-white p-2 border border-stone-200 shadow-none transition-transform group-hover:scale-110">{preset.emoji}</span>
              <div className="space-y-1">
                <div className="text-xs font-bold text-stone-900 group-hover:text-black">
                  {preset.label}
                </div>
                <div className="text-[10px] text-stone-400 leading-tight font-serif italic">
                  {preset.topic}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
