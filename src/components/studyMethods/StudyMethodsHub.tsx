import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Word, TTSConfig, LLMConfig, StudyMethodTab } from "../../types";
import MethodsOverviewBanner from "./MethodsOverviewBanner";
import GoldlistMethodView from "./GoldlistMethodView";
import StoryImmersionView from "./StoryImmersionView";
import MemoryPalaceView from "./MemoryPalaceView";
import WrapStudioView from "./WrapStudioView";
import RealWorldUtilityView from "./RealWorldUtilityView";

interface StudyMethodsHubProps {
  words: Word[];
  targetLanguage: string;
  nativeLanguage: string;
  appLanguage?: string;
  ttsConfig?: TTSConfig;
  llmConfig?: LLMConfig;
  initialTab?: StudyMethodTab;
  onUpdateWords?: (updated: Word[]) => void;
  onAddWord?: (wordOrData: any, hint?: string) => void;
}

export default function StudyMethodsHub({
  words,
  targetLanguage,
  nativeLanguage,
  appLanguage = "Vietnamese",
  ttsConfig,
  llmConfig,
  initialTab = "goldlist",
  onUpdateWords,
  onAddWord
}: StudyMethodsHubProps) {
  const [activeTab, setActiveTab] = useState<StudyMethodTab>(initialTab);

  return (
    <div className="w-full max-w-7xl mx-auto space-y-4 animate-in fade-in duration-200">
      {/* Top Interactive Banner with Overview Matrix */}
      <MethodsOverviewBanner
        activeTab={activeTab}
        onSelectTab={(tab) => setActiveTab(tab)}
        appLanguage={appLanguage}
      />

      {/* Main Method View Switcher */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15 }}
        >
          {activeTab === "goldlist" && (
            <GoldlistMethodView
              words={words}
              targetLanguage={targetLanguage}
              nativeLanguage={nativeLanguage}
              appLanguage={appLanguage}
              ttsConfig={ttsConfig}
              llmConfig={llmConfig}
              onUpdateWords={onUpdateWords}
            />
          )}

          {activeTab === "immersion" && (
            <StoryImmersionView
              words={words}
              targetLanguage={targetLanguage}
              nativeLanguage={nativeLanguage}
              appLanguage={appLanguage}
              ttsConfig={ttsConfig}
              llmConfig={llmConfig}
              onUpdateWords={onUpdateWords}
              onAddWord={onAddWord}
            />
          )}

          {activeTab === "palace" && (
            <MemoryPalaceView
              words={words}
              targetLanguage={targetLanguage}
              nativeLanguage={nativeLanguage}
              appLanguage={appLanguage}
              ttsConfig={ttsConfig}
              llmConfig={llmConfig}
              onUpdateWords={onUpdateWords}
            />
          )}

          {activeTab === "wrap" && (
            <WrapStudioView
              words={words}
              targetLanguage={targetLanguage}
              nativeLanguage={nativeLanguage}
              appLanguage={appLanguage}
              ttsConfig={ttsConfig}
              llmConfig={llmConfig}
              onUpdateWords={onUpdateWords}
            />
          )}

          {activeTab === "physical" && (
            <RealWorldUtilityView
              words={words}
              targetLanguage={targetLanguage}
              nativeLanguage={nativeLanguage}
              appLanguage={appLanguage}
              ttsConfig={ttsConfig}
              llmConfig={llmConfig}
              onUpdateWords={onUpdateWords}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
