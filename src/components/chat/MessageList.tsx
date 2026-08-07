import { Fragment } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChatMessage, LLMConfig, TTSConfig } from "../../types";
import ChatMessageItem from "./ChatMessageItem";

interface MessageListProps {
  messages: ChatMessage[];
  isTyping: boolean;
  targetLanguage: string;
  nativeLanguage: string;
  ttsConfig: TTSConfig;
  llmConfig: LLMConfig;
  onSendMessage: (text: string) => Promise<void>;
  onClearHistory: () => void;
  onAddWord: (word?: string, hint?: string) => void;
  onAddMultipleWords?: (words: any[]) => void;
  onStartQuiz: () => void;
  onFixGrammar: () => void;
  onViewFlashcard?: () => void;
  onAnalyzeImageVocab?: (imageDataUrl: string, prompt?: string) => void;
  onSuggestCasualReplyPrompt?: () => void;
  onSuggestCasualReply?: (imageDataUrl: string | null, customPrompt: string) => Promise<void>;
  onSelectDefinition?: (word: string, senseIndex: number, translation: string) => void;
  showToast: (msg: string) => void;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  focusInput: () => void;
  setIsPhotoModalOpen: (open: boolean) => void;
  handleRecordActionUse: (actionId: string) => void;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  latestMessageRef: React.RefObject<HTMLDivElement | null>;
}

export default function MessageList({
  messages,
  isTyping,
  targetLanguage,
  nativeLanguage,
  ttsConfig,
  llmConfig,
  onSendMessage,
  onClearHistory,
  onAddWord,
  onAddMultipleWords,
  onStartQuiz,
  onFixGrammar,
  onViewFlashcard,
  onAnalyzeImageVocab,
  onSuggestCasualReplyPrompt,
  onSuggestCasualReply,
  onSelectDefinition,
  showToast,
  scrollToBottom,
  focusInput,
  setIsPhotoModalOpen,
  handleRecordActionUse,
  messagesEndRef,
  latestMessageRef,
}: MessageListProps) {
  return (
    <div 
      className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-stone-50/50 chat-message-body" 
      id="chat-messages-body"
    >
      <AnimatePresence initial={false}>
        {messages.map((msg, idx) => {
          const isLatestMessage = idx === messages.length - 1;
          return (
            <Fragment key={msg.id}>
              {isLatestMessage && (
                <div ref={latestMessageRef} />
              )}
              <ChatMessageItem
                msg={msg}
                isLatestMessage={isLatestMessage}
                messages={messages}
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
              />
            </Fragment>
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
  );
}
