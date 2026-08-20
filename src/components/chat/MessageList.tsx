import React, { Fragment } from "react";
import { ChatMessage, LLMConfig, TTSConfig, Word } from "../../types";
import ChatMessageItem from "./ChatMessageItem";
import LlmProgressIndicator from "./LlmProgressIndicator";

interface MessageListProps {
  messages: ChatMessage[];
  isTyping: boolean;
  activeModelInfo?: { provider: string; model: string } | null;
  onCancelTyping?: () => void;
  targetLanguage: string;
  nativeLanguage: string;
  appLanguage?: string;
  ttsConfig: TTSConfig;
  llmConfig: LLMConfig;
  onSendMessage: (text: string) => Promise<void>;
  onAddWord: (word?: string, hint?: string) => void;
  onAddMultipleWords?: (words: any[]) => void;
  onGenerateByTopic?: () => void;
  startPractice: () => void;
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
  words?: Word[];
  onUpdateWords?: (updatedWords: Word[]) => void;
  onRetryErrorMessage?: (messageId: string) => void;
  onCancelErrorMessage?: (messageId: string) => void;
}

function MessageList({
  messages,
  isTyping,
  activeModelInfo,
  onCancelTyping,
  targetLanguage,
  nativeLanguage,
  appLanguage,
  ttsConfig,
  llmConfig,
  onSendMessage,
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
  showToast,
  scrollToBottom,
  focusInput,
  setIsPhotoModalOpen,
  handleRecordActionUse,
  messagesEndRef,
  latestMessageRef,
  words,
  onUpdateWords,
  onRetryErrorMessage,
  onCancelErrorMessage,
}: MessageListProps) {
  return (
    <div 
      className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-stone-50/50 chat-message-body" 
      id="chat-messages-body"
    >
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
              words={words}
              onUpdateWords={onUpdateWords}
              onRetryErrorMessage={onRetryErrorMessage}
              onCancelErrorMessage={onCancelErrorMessage}
            />
          </Fragment>
        );
      })}

      {/* Progress Indicator */}
      {isTyping && (
        <LlmProgressIndicator llmConfig={llmConfig} activeModelInfo={activeModelInfo} onCancel={onCancelTyping} />
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}

export default React.memo(MessageList);
