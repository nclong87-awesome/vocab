import { useState, useEffect, useMemo } from "react";
import { Plus } from "lucide-react";
import { 
  JitActionChip, 
  getDynamicJitChipsForWord,
  getDynamicJitChipsForChat,
  CUSTOM_ACTIONS_UPDATED_EVENT
} from "../../services/jitActionChipsService";
import { Word, UserPersonalityProfile } from "../../types";

interface JitActionChipsBarProps {
  mode: "word" | "chat";
  word?: Word;
  lastAssistantMessage?: string;
  personalityProfile?: UserPersonalityProfile | null;
  nativeLanguage?: string;
  targetLanguage?: string;
  onSelectChip: (query: string, actionChip: JitActionChip, executionMode: "send" | "edit") => void;
  onOpenCustomActionModal?: () => void;
  className?: string;
}

export default function JitActionChipsBar({
  mode,
  word,
  lastAssistantMessage,
  personalityProfile,
  nativeLanguage = "Vietnamese",
  targetLanguage = "English",
  onSelectChip,
  onOpenCustomActionModal,
  className = ""
}: JitActionChipsBarProps) {
  const [refreshKey, setRefreshKey] = useState(0);

  // Listen to custom action updates
  useEffect(() => {
    const handleUpdate = () => {
      setRefreshKey(k => k + 1);
    };
    window.addEventListener(CUSTOM_ACTIONS_UPDATED_EVENT, handleUpdate);
    return () => window.removeEventListener(CUSTOM_ACTIONS_UPDATED_EVENT, handleUpdate);
  }, []);

  // Compute dynamic chips - single curated list without category tabs
  const chips = useMemo(() => {
    if (mode === "word" && word) {
      return getDynamicJitChipsForWord({
        word,
        lastAssistantMessage,
        personalityProfile,
        nativeLanguage,
        targetLanguage,
        selectedCategory: "all"
      });
    } else {
      return getDynamicJitChipsForChat({
        lastMessage: lastAssistantMessage,
        personalityProfile,
        nativeLanguage,
        targetLanguage
      });
    }
  }, [mode, word, lastAssistantMessage, personalityProfile, nativeLanguage, targetLanguage, refreshKey]);

  if (chips.length === 0) {
    return null;
  }

  return (
    <div className={`flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs ${className}`} id="dynamic-jit-action-chips-dock">
      {chips.map((chip) => {
        const isCustom = chip.isCustom;
        const isContext = chip.category === "jit_context";

        return (
          <button
            key={chip.id}
            type="button"
            onClick={() => onSelectChip(chip.query, chip, "edit")}
            title={chip.query}
            className={`px-3 py-1.5 rounded-full shrink-0 font-medium transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 active:scale-95 select-none text-xs ${
              isCustom
                ? "bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200/80"
                : isContext
                ? "bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-200"
                : "bg-stone-100 hover:bg-stone-200 text-stone-700"
            }`}
          >
            {chip.iconEmoji && <span className="text-xs">{chip.iconEmoji}</span>}
            <span>{chip.label}</span>
          </button>
        );
      })}

      {onOpenCustomActionModal && (
        <button
          type="button"
          onClick={onOpenCustomActionModal}
          className="px-2.5 py-1.5 rounded-full bg-stone-50 hover:bg-stone-100 text-stone-500 hover:text-stone-800 border border-dashed border-stone-300 shrink-0 font-medium text-xs transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1 select-none active:scale-95"
          title="Create or customize quick actions"
        >
          <Plus className="w-3 h-3 text-stone-400" />
          <span>Custom</span>
        </button>
      )}
    </div>
  );
}
