import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Plus } from "lucide-react";
import { LLMConfig, LLMProvider, Word } from "../../types";
import { getQuickActionItems } from "./quickActionsConfig";
import { 
  getCustomQuickActions, 
  CustomQuickAction, 
  CUSTOM_ACTIONS_UPDATED_EVENT, 
  formatPromptWithContext 
} from "../../services/jitActionChipsService";
import CustomQuickActionModal from "./CustomQuickActionModal";

interface QuickActionsSectionProps {
  targetLanguage: string;
  nativeLanguage: string;
  appLanguage?: string;
  llmConfig: LLMConfig;
  actionLastUsed: Record<string, number>;
  handleRecordActionUse: (actionId: string) => void;
  onSendMessage: (text: string, overrideConfig?: any, options?: any) => Promise<void>;
  onClearHistory: () => void;
  onAddWord: (word?: string, hint?: string) => void;
  onGenerateByTopic?: () => void;
  startPractice: (overrideConfig?: any, mode?: any, options?: any) => void;
  onFixGrammar: () => void;
  onSuggestCasualReplyPrompt?: () => void;
  onOpenWordLibrary?: () => void;
  onOpenChallenge?: () => void;
  onSwitchProvider?: (provider: LLMProvider, model?: string) => void;
  showToast: (msg: string) => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  focusInput: () => void;
  setIsPhotoModalOpen: (open: boolean) => void;
  setSelectedImage: (img: { dataUrl: string; name: string } | null) => void;
  words?: Word[];
}

function QuickActionsSection({
  targetLanguage,
  nativeLanguage,
  appLanguage = "Vietnamese",
  llmConfig,
  actionLastUsed,
  handleRecordActionUse,
  onSendMessage,
  onClearHistory,
  onAddWord,
  onGenerateByTopic,
  startPractice,
  onFixGrammar,
  onSuggestCasualReplyPrompt,
  onOpenWordLibrary,
  onOpenChallenge,
  onSwitchProvider,
  showToast,
  scrollToBottom,
  focusInput,
  setIsPhotoModalOpen,
  setSelectedImage,
  words: _words,
}: QuickActionsSectionProps) {
  const [isCustomModalOpen, setIsCustomModalOpen] = useState(false);
  const [customActions, setCustomActions] = useState<CustomQuickAction[]>([]);
  const dockScrollRef = useRef<HTMLDivElement>(null);

  const loadCustomActions = useCallback(() => {
    setCustomActions(getCustomQuickActions().filter(a => a.scope === "both" || a.scope === "chat"));
  }, []);

  useEffect(() => {
    loadCustomActions();
    window.addEventListener(CUSTOM_ACTIONS_UPDATED_EVENT, loadCustomActions);
    return () => window.removeEventListener(CUSTOM_ACTIONS_UPDATED_EVENT, loadCustomActions);
  }, [loadCustomActions]);

  const propsRef = useRef({
    targetLanguage,
    nativeLanguage,
    llmConfig,
    actionLastUsed,
    handleRecordActionUse,
    onSendMessage,
    onClearHistory,
    onAddWord,
    onGenerateByTopic,
    startPractice,
    onFixGrammar,
    onSuggestCasualReplyPrompt,
    onOpenWordLibrary,
    onOpenChallenge,
    onSwitchProvider,
    showToast,
    scrollToBottom,
    focusInput,
    setIsPhotoModalOpen,
    setSelectedImage,
  });

  useEffect(() => {
    propsRef.current = {
      targetLanguage,
      nativeLanguage,
      llmConfig,
      actionLastUsed,
      handleRecordActionUse,
      onSendMessage,
      onClearHistory,
      onAddWord,
      onGenerateByTopic,
      startPractice,
      onFixGrammar,
      onSuggestCasualReplyPrompt,
      onOpenWordLibrary,
      onOpenChallenge,
      onSwitchProvider,
      showToast,
      scrollToBottom,
      focusInput,
      setIsPhotoModalOpen,
      setSelectedImage,
    };
  });

  const quickActionItems = useMemo(() => {
    const allQuickActionItems = getQuickActionItems(appLanguage).map((item) => ({
      ...item,
      onClick: () => {
        const p = propsRef.current;
        p.handleRecordActionUse(item.id);
        if (item.id !== "suggest_reply") {
          p.setSelectedImage(null);
        }
        
        item.getAction({
          targetLanguage: p.targetLanguage,
          nativeLanguage: p.nativeLanguage,
          onFixGrammar: p.onFixGrammar,
          startPractice: p.startPractice,
          onGenerateByTopic: () => {
            if (p.onGenerateByTopic) {
              p.onGenerateByTopic();
            }
          },
          onAddWord: p.onAddWord,
          onSendMessage: p.onSendMessage,
          onClearHistory: p.onClearHistory,

          onSuggestCasualReplyPrompt: () => {
            p.setIsPhotoModalOpen(true);
            p.onSuggestCasualReplyPrompt?.();
          },
          onOpenWordLibrary: p.onOpenWordLibrary,
          onOpenChallenge: p.onOpenChallenge,
        });
        p.scrollToBottom("smooth");
        p.focusInput();
      }
    }));

    const customItems = customActions.map((c, idx) => ({
      id: `custom_${c.id}`,
      label: c.label,
      category: (c.category === "custom" ? "custom" : c.category) as any,
      categoryLabel: "Custom",
      icon: <span className="text-sm select-none">{c.iconEmoji || "⭐"}</span>,
      title: c.label,
      description: c.description || c.promptTemplate,
      className: "bg-amber-50/90 hover:bg-amber-100 text-amber-950 border border-amber-300/80 text-xs font-bold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1.5",
      defaultIndex: c.isPinned ? -10 + idx : 20 + idx,
      onClick: () => {
        const p = propsRef.current;
        p.handleRecordActionUse(`custom_${c.id}`);
        p.onClearHistory();
        const formatted = formatPromptWithContext(c.promptTemplate, {
          targetLanguage: p.targetLanguage,
          nativeLanguage: p.nativeLanguage
        });
        p.onSendMessage(formatted);
        p.scrollToBottom("smooth");
        p.focusInput();
      }
    }));

    const combined = [...allQuickActionItems, ...customItems];

    return combined.sort((a, b) => {
      const timeA = actionLastUsed[a.id] || 0;
      const timeB = actionLastUsed[b.id] || 0;
      if (timeB !== timeA) {
        return timeB - timeA;
      }
      return a.defaultIndex - b.defaultIndex;
    });
  }, [appLanguage, customActions]);

  return (
    <>
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
            return (
              <button
                key={item.id}
                onClick={item.onClick}
                className={`${item.className} relative group`}
                title={item.title}
                id={`quick-action-btn-${item.id}`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            );
          })}

          {/* Quick Add Custom Action Chip in Dock */}
          <button
            type="button"
            onClick={() => setIsCustomModalOpen(true)}
            className="bg-white hover:bg-stone-50 text-stone-600 hover:text-stone-900 border border-dashed border-stone-300 text-xs font-semibold py-1.5 px-2.5 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0 flex items-center gap-1 select-none"
            title="Create a custom quick action chip"
          >
            <Plus className="w-3 h-3 text-amber-600" />
            <span className="hidden sm:inline">Custom</span>
          </button>
        </div>
      </div>

      {/* Custom Quick Actions Management Modal */}
      <CustomQuickActionModal
        isOpen={isCustomModalOpen}
        onClose={() => setIsCustomModalOpen(false)}
        targetLanguage={targetLanguage}
        nativeLanguage={nativeLanguage}
        appLanguage={appLanguage}
      />
    </>
  );
}

export default React.memo(QuickActionsSection);
