import React, { useState, useMemo } from "react";
import { 
  Volume2, ChevronRight, Check, Sparkles, Clock
} from "lucide-react";
import { ChatMessage, LLMConfig, TTSConfig, Word } from "../../types";
import { speakText, getLanguageCode } from "../../utils/ttsService";
import FormattedMessage from "./FormattedMessage";
import QuizImage from "../quiz/QuizImage";
import FlashcardMessageCard from "./FlashcardMessageCard";
import { extractOrGenerateTopicActions } from "../../utils/actionExtractor";

interface ChatMessageItemProps {
  msg: ChatMessage;
  isLatestMessage: boolean;
  messages: ChatMessage[];
  targetLanguage: string;
  nativeLanguage: string;
  appLanguage?: string;
  ttsConfig: TTSConfig;
  llmConfig: LLMConfig;
  onSendMessage: (text: string) => Promise<void>;
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
  words?: Word[];
  onUpdateWords?: (updatedWords: Word[]) => void;
}

function formatActionLabel(act: { label: string; action: string; payload?: any }, isVi: boolean): string {
  if (!act || !act.label) return "";
  const rawLabel = String(act.label).trim();

  if (!isVi) {
    return rawLabel;
  }

  const lower = rawLabel.toLowerCase();

  if (act.action === "view_flashcard" || lower.includes("next flash card") || lower.includes("next flashcard")) {
    return "🃏 Thẻ Ghi Nhớ Tiếp Theo";
  }

  if (act.action === "start_quiz" || lower.includes("start quiz") || lower.includes("start vocab quiz")) {
    return "🧠 Bắt Đầu Bài Quiz Hôm Nay";
  }

  if (act.action === "fix_another" || lower === "fix another sentence" || lower.includes("fix another")) {
    return "✍️ Sửa Câu Khác";
  }

  if (act.action === "suggest_another" || lower === "suggest another casual reply" || lower.includes("suggest another")) {
    return "💬 Gợi Ý Câu Trả Lời Khác";
  }

  if (act.action === "copy_text" || act.action === "copy_sentence" || lower.includes("copy fixed sentence") || lower.includes("copy sentence")) {
    return "📋 Sao Chép Câu Đã Sửa";
  }

  if (act.action === "add_word" || act.action === "confirm_save_word") {
    const word = act.payload?.word || (act as any).word;
    const hint = act.payload?.hint || act.payload?.translation || (act as any).hint || (act as any).translation;

    if (word) {
      if (hint) {
        return `➕ Thêm "${word}" (${hint})`;
      }
      const matchParen = rawLabel.match(/\(([^)]+)\)/);
      if (matchParen && matchParen[1]) {
        return `➕ Thêm "${word}" (${matchParen[1]})`;
      }
      return `➕ Thêm "${word}" vào bộ từ vựng`;
    }
  }

  if (act.action === "add_multiplewords" || lower.includes("add all")) {
    const count = act.payload?.words?.length;
    if (count) {
      return `✨ Thêm Tất Cả (${count}) Từ Vựng Vào Bộ Sưu Tập`;
    }
    return "✨ Thêm Tất Cả Từ Vựng Vào Bộ Sưu Tập";
  }

  if (lower.startsWith("add ") || lower.startsWith("+ add ") || lower.startsWith("➕ add ")) {
    let replaced = rawLabel.replace(/^(\+ |➕ )?Add /i, "➕ Thêm ");
    replaced = replaced.replace(/ to collection/i, " vào bộ từ vựng");
    return replaced;
  }

  return rawLabel;
}

function ChatMessageItem({
  msg,
  isLatestMessage,
  messages,
  targetLanguage,
  nativeLanguage,
  appLanguage,
  ttsConfig,
  llmConfig,
  onSendMessage,
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
  words,
  onUpdateWords,
}: ChatMessageItemProps) {
  const isUser = msg.role === "user";
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "Vietnamese";
  const isVi = currentAppLang.toLowerCase().includes("vi") || currentAppLang.toLowerCase().includes("vietnam");

  const handleCopy = (textToCopy: string, key: string, toastMessage: string) => {
    navigator.clipboard.writeText(textToCopy);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
    showToast(toastMessage);
  };

  const safeMsgContent = typeof msg.content === "string" ? msg.content : (msg.content ? String(msg.content) : "");

  const parsedQuizOptions = useMemo(() => {
    const opts: { label: string; action: string; payload: any }[] = [];
    if (!isUser && safeMsgContent) {
      const lines = safeMsgContent.split("\n");
      for (const line of lines) {
        const cleanLine = line.trim();
        const match = cleanLine.match(/^\s*(?:\*\*)?\s*([A-E])\s*[\)\.]\s*(?:\*\*)?\s*(.+)$/i);
        if (match) {
          const optionLabel = cleanLine.replace(/\*\*|`/g, "").trim();
          const optionText = match[2].replace(/\*\*|`/g, "").trim();
          opts.push({
            label: optionLabel,
            action: "quiz_answer",
            payload: { answer: optionText }
          });
        }
      }
    }
    return opts;
  }, [isUser, safeMsgContent]);

  const effectiveActions = useMemo(() => {
    let rawActions: { label: string; action: string; payload?: any }[] = [];

    if (!isUser) {
      const hasQuizOptions = parsedQuizOptions.length >= 2 && parsedQuizOptions.length <= 5;
      
      if (hasQuizOptions) {
        rawActions = [...parsedQuizOptions];
      } else if (msg.suggestedActions && msg.suggestedActions.length > 0) {
        rawActions = [...msg.suggestedActions];
      }

      // On the latest message, if no quiz options are present, extract or generate topic choices
      if (isLatestMessage && !hasQuizOptions) {
        const content = safeMsgContent;
        const lastUserMessage = [...messages].reverse().find(m => m.role === "user")?.content || "";

        rawActions = extractOrGenerateTopicActions(
          content,
          rawActions,
          lastUserMessage,
          targetLanguage,
          nativeLanguage
        );

        const hasNextAction = rawActions.some(a => {
          const lbl = (a && typeof a.label === "string") ? a.label.toLowerCase() : "";
          return (
            lbl.includes("question") || 
            lbl.includes("move on") || 
            lbl.includes("continue to") || 
            lbl.includes("next question")
          );
        });

        if (!hasNextAction) {
          const questionMatch = content.match(/(?:move\s+on\s+to|continue\s+to|proceed\s+to|shall\s+we\s+(?:move\s+on\s+to|try|start|go\s+to)?)\s*\*{0,2}(Question\s*\d+|the\s+next\s+question)\*{0,2}/i)
            || content.match(/move\s+on\s+to\s+\*{0,2}(Question\s*\d+)\*{0,2}/i)
            || content.match(/shall\s+we\s+move\s+on\s+to\s+\*{0,2}(Question\s*\d+)\*{0,2}/i);

          if (questionMatch) {
            const qStr = questionMatch[1] ? questionMatch[1].replace(/\*/g, "").trim() : "";
            const labelText = qStr ? `Move on to ${qStr}` : "Move on to next question";
            rawActions.push({
              label: labelText,
              action: "send_message",
              payload: { message: labelText }
            });
          } else if (
            content.toLowerCase().includes("move on to") || 
            content.toLowerCase().includes("shall we move on") || 
            content.toLowerCase().includes("next question") ||
            content.toLowerCase().includes("ready for the next")
          ) {
            rawActions.push({
              label: "Move on to next question",
              action: "send_message",
              payload: { message: "Move on to next question" }
            });
          }
        }
      }

      // Filter actions if this is NOT the latest message in the thread:
      if (!isLatestMessage) {
        rawActions = rawActions.filter(a => a.action === "add_word" || a.action === "select_definition" || a.action === "retry_analyze_image" || a.action === "retry_suggest_reply" || a.action === "copy_text" || a.action === "copy_sentence");
      }
    }

    return (rawActions || [])
      .filter(act => {
        if (!act || typeof act !== "object") return false;
        if (act.action === "select_definition") return Boolean(act.payload?.definition);
        const lbl = act.label ? String(act.label).trim() : "";
        const msgPayload = act.payload?.message ? String(act.payload.message).trim() : "";
        const wordPayload = act.payload?.word || (act as any).word ? String(act.payload?.word || (act as any).word).trim() : "";
        return lbl.length > 0 || msgPayload.length > 0 || wordPayload.length > 0;
      })
      .map(act => {
        const cleaned = { ...act };
        if (!cleaned.label || !String(cleaned.label).trim()) {
          if (cleaned.payload?.message) cleaned.label = cleaned.payload.message;
          else if (cleaned.payload?.word) cleaned.label = `Add "${cleaned.payload.word}" to collection`;
          else if ((cleaned as any).word) cleaned.label = `Add "${(cleaned as any).word}" to collection`;
        }
        return cleaned;
      });
  }, [isUser, parsedQuizOptions, msg.suggestedActions, isLatestMessage, safeMsgContent, messages, targetLanguage, nativeLanguage]);

  let className = isUser ? "flex flex-col max-w-[85%] sm:max-w-[75%] w-full ml-auto items-end" : "flex flex-col max-w-full w-full mr-auto items-stretch";
  if (isLatestMessage) {
    className += " pt-1";
  }

  return (
    <div className={`${className} animate-chat-msg`}>
      {/* Message Content Bubble */}
      {/* Message Content Bubble */}
      <div className="space-y-2 w-full flex flex-col">
        <div 
          className={
            msg.flashcardData 
              ? "w-full"
              : `p-4 rounded-2xl w-full ${
                  isUser 
                    ? "bg-stone-900 text-white border border-stone-850 rounded-tr-none shadow-xs" 
                    : "bg-white border border-stone-200/60 text-stone-900 rounded-tl-none shadow-3xs"
                }`
          }
        >
          {/* Format standard Markdown */}
          {isUser ? (
            <div className="space-y-2">
              <p className="text-sm sm:text-base leading-relaxed font-medium break-words text-white">{msg.content}</p>
              {msg.imageUrl && (
                <div className="mt-2 max-w-sm rounded-xl overflow-hidden border border-stone-200 bg-stone-900/5 shadow-2xs">
                  <img 
                    src={msg.imageUrl} 
                    alt="Uploaded photo" 
                    className="w-full max-h-64 object-cover rounded-xl"
                  />
                </div>
              )}
            </div>
          ) : msg.flashcardData ? (
            <FlashcardMessageCard
              data={msg.flashcardData}
              targetLanguage={targetLanguage}
              nativeLanguage={nativeLanguage}
              appLanguage={currentAppLang}
              ttsConfig={ttsConfig}
              llmConfig={llmConfig}
              provider={msg.provider}
              model={msg.model}
              responseTimeMs={msg.responseTimeMs}
              words={words}
              onUpdateWords={onUpdateWords}
              showToast={showToast}
            />
          ) : (
            <>
              <FormattedMessage text={msg.content} />

              {/* Fixed sentence copy card */}
              {msg.fixedSentence && (
                <div className="mt-3 p-3.5 bg-amber-50/90 border border-amber-200/90 rounded-xl flex items-center justify-between gap-3 shadow-2xs">
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] font-bold text-amber-900 uppercase tracking-wider block font-mono">
                      Polished Sentence:
                    </span>
                    <p className="text-xs sm:text-sm font-semibold text-stone-900 break-words mt-0.5">
                      "{msg.fixedSentence}"
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(msg.fixedSentence!, `fixed-${msg.id}`, "📋 Copied fixed sentence to clipboard!")}
                    className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-amber-400 font-bold text-xs rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shrink-0 shadow-2xs hover:scale-105 active:scale-95"
                    title="Copy fixed sentence to clipboard"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{copiedKey === `fixed-${msg.id}` ? "Copied!" : "Copy"}</span>
                  </button>
                </div>
              )}

              {/* Suggested replies cards with direct Copy buttons */}
              {msg.suggestedReplies && msg.suggestedReplies.length > 0 && (
                <div className="mt-4 space-y-3 border-t border-stone-100/80 pt-3">
                  <span className="text-[10px] font-bold text-stone-500 uppercase tracking-wider block font-mono mb-2">
                    Suggested Replies (Quick Copy):
                  </span>
                  <div className="grid grid-cols-1 gap-3">
                    {msg.suggestedReplies.map((rep, idx) => {
                      const repKey = `reply-${msg.id}-${idx}`;
                      const isCopied = copiedKey === repKey;
                      return (
                        <div
                          key={idx}
                          className="p-3.5 bg-amber-50/90 border border-amber-200/90 rounded-xl flex items-start justify-between gap-3 shadow-2xs transition-all hover:border-amber-300/90"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 flex-wrap mb-1">
                              <span className="text-[10px] font-extrabold text-amber-950 font-mono bg-amber-200/80 px-1.5 py-0.5 rounded">
                                Option {idx + 1}
                              </span>
                              {rep.tone && (
                                <span className="text-[10px] font-semibold text-amber-900 bg-amber-100/90 border border-amber-300/50 px-1.5 py-0.5 rounded-md">
                                  {rep.tone}
                                </span>
                              )}
                            </div>
                            <p className="text-xs sm:text-sm font-semibold text-stone-900 break-words mt-1">
                              "{rep.reply}"
                            </p>
                            {rep.translation && (
                              <p className="text-xs text-amber-900/80 italic mt-1.5 font-medium">
                                {rep.translation}
                              </p>
                            )}
                            {rep.explanation && (
                              <p className="text-xs text-stone-600 mt-1 leading-normal">
                                {rep.explanation}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCopy(rep.reply, repKey, "📋 Copied suggestion to clipboard!")}
                            className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-amber-400 font-bold text-xs rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shrink-0 shadow-2xs hover:scale-105 active:scale-95 mt-0.5"
                            title="Copy suggestion to clipboard"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>{isCopied ? "Copied!" : "Copy"}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Image for visual picture questions or photo analysis */}
              {(msg.imageUrl || msg.imageKeyword) && (
                <div className="my-2.5 max-w-md rounded-xl border border-stone-200 overflow-hidden bg-stone-100 shadow-2xs">
                  {msg.imageUrl && (msg.imageUrl.startsWith("data:") || msg.imageUrl.startsWith("blob:")) ? (
                    <img 
                      src={msg.imageUrl} 
                      alt={msg.audioWord || "Uploaded photo"} 
                      className="w-full max-h-80 object-cover rounded-xl"
                    />
                  ) : (
                    <QuizImage
                      imageKeyword={msg.imageKeyword}
                      alt="Quiz visual clue" 
                      word={msg.audioWord || "Quiz clue"} 
                    />
                  )}
                </div>
              )}

              {/* Audio clip player card for listening questions */}
              {msg.audioWord && (
                <div className="bg-amber-50/90 border border-amber-200/90 rounded-xl p-3 sm:p-3.5 my-2.5 flex items-center justify-between gap-3 shadow-2xs">
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => speakText(msg.audioWord!, ttsConfig, llmConfig, getLanguageCode(targetLanguage))}
                      className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-stone-900 hover:bg-stone-800 text-amber-400 flex items-center justify-center shrink-0 shadow-xs cursor-pointer transition-transform hover:scale-105"
                      title="Play audio clip"
                    >
                      <Volume2 className="w-5 h-5" />
                    </button>
                    <div>
                      <h5 className="text-xs font-bold text-stone-900 uppercase tracking-wider flex items-center gap-1">
                        <Volume2 className="w-3.5 h-3.5 text-amber-600" />
                        Audio Clip
                      </h5>
                      <p className="text-[11px] text-stone-600 font-serif italic">
                        Tap play to listen to the target word
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => speakText(msg.audioWord!, ttsConfig, llmConfig, getLanguageCode(targetLanguage))}
                    className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-amber-400 font-bold text-xs rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shrink-0 shadow-2xs"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    Play Clip
                  </button>
                </div>
              )}

              {/* AI Response Metadata (Provider, Model, Response Time) */}
              {(msg.provider || msg.model || msg.responseTimeMs !== undefined) && (
                <div className="mt-3 pt-2 border-t border-stone-100 flex items-center justify-between text-[11px] text-stone-400 font-medium select-none">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {msg.provider && (
                      <span className="capitalize font-semibold text-stone-600 bg-stone-100 px-1.5 py-0.5 rounded text-[10.5px]">
                        {msg.provider}
                      </span>
                    )}
                    {msg.model && (
                      <span className="font-mono text-[10.5px] text-stone-500">
                        {msg.model}
                      </span>
                    )}
                  </div>
                  {msg.responseTimeMs !== undefined && (
                    <div className="flex items-center gap-1 text-stone-400 shrink-0 text-[11px] font-mono" title="AI Response Time">
                      <Clock className="w-3 h-3 text-stone-400" />
                      <span>{(msg.responseTimeMs / 1000).toFixed(2)}s</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* AI Suggested Actions Render */}
        {!isUser && effectiveActions && effectiveActions.length > 0 && (
          <div className="flex flex-col gap-1.5 pt-1 w-full">
            {effectiveActions.map((act, aIdx) => {
              const actLbl = (act && typeof act.label === "string") ? act.label.toLowerCase() : "";
              const isNextQ = act.action === "send_message" && (
                actLbl.startsWith("move on") ||
                actLbl.startsWith("next question") ||
                actLbl.includes("continue to question")
              );

              return (
                <button
                  key={aIdx}
                  onClick={() => {
                    if (act.action === "copy_text" || act.action === "copy_sentence") {
                      const textToCopy = act.payload?.text || msg.fixedSentence || "";
                      if (textToCopy) {
                        navigator.clipboard.writeText(textToCopy);
                        showToast(isVi ? "📋 Đã sao chép vào bộ nhớ tạm!" : "📋 Copied selection to clipboard!");
                      }
                    } else if (act.action === "suggest_another") {
                      handleRecordActionUse("suggest_reply");
                      setIsPhotoModalOpen(true);
                      onSuggestCasualReplyPrompt?.();
                    } else if (act.action === "fix_another") {
                      handleRecordActionUse("fix_grammar");
                      onFixGrammar();
                    } else if (act.action === "confirm_save_word" && act.payload && onAddMultipleWords) {
                      onAddMultipleWords([act.payload]);
                      showToast(isVi ? `🎉 Đã thêm "${act.payload.word}" vào bộ từ vựng!` : `🎉 Added "${act.payload.word}" to collection!`);
                    } else if (act.action === "add_word" && act.payload?.word) {
                      handleRecordActionUse("add_word");
                      onAddWord(act.payload.word, act.payload?.hint);
                    } else if (act.action === "add_multiplewords" && act.payload?.words && onAddMultipleWords) {
                      onAddMultipleWords(act.payload.words);
                      showToast(isVi ? `🎉 Đã thêm ${act.payload.words.length} từ vựng vào bộ sưu tập!` : `🎉 Added ${act.payload.words.length} vocabulary words to collection!`);
                    } else if (act.action === "start_quiz") {
                      handleRecordActionUse("start_quiz");
                      onStartQuiz();
                    } else if (act.action === "view_flashcard") {
                      handleRecordActionUse("view_flashcard");
                      onViewFlashcard?.();
                    } else if (act.action === "quiz_answer" && act.payload?.answer) {
                      onSendMessage(act.payload.answer);
                    } else if (act.action === "select_definition" && act.payload && onSelectDefinition) {
                      onSelectDefinition(act.payload.word, act.payload.senseIndex, act.payload.translation);
                    } else if (act.action === "common_phrases") {
                      handleRecordActionUse("common_phrases");
                      onSendMessage(
                        `I'd like to learn common phrases and idioms in ${targetLanguage} (with ${nativeLanguage} translations).`
                      );
                      scrollToBottom("smooth");
                      focusInput();
                    } else if (act.action === "explain_grammar") {
                      handleRecordActionUse("explain_grammar");
                      onSendMessage(
                        `I'd like to explore grammar rules in ${targetLanguage} (explained in ${nativeLanguage}).`
                      );
                      scrollToBottom("smooth");
                      focusInput();
                    } else if (act.action === "translate_contrast") {
                      handleRecordActionUse("translate_contrast");
                      onSendMessage(
                        `I'd like to translate a phrase and compare nuances between ${nativeLanguage} and ${targetLanguage}.`
                      );
                      scrollToBottom("smooth");
                      focusInput();
                    } else if (act.action === "retry_analyze_image" && onAnalyzeImageVocab) {
                      const imageToRetry = act.payload?.imageDataUrl || [...messages].reverse().find(m => Boolean(m.imageUrl))?.imageUrl;
                      if (imageToRetry) {
                        showToast(isVi ? "🔄 Đang phân tích lại từ vựng từ hình ảnh..." : "🔄 Retrying photo vocabulary analysis...");
                        onAnalyzeImageVocab(imageToRetry, act.payload?.customPrompt);
                      } else {
                        showToast(isVi ? "📷 Vui lòng tải lên hoặc chọn một bức ảnh để phân tích" : "📷 Please upload or select a photo to analyze");
                        setIsPhotoModalOpen(true);
                      }
                    } else if (act.action === "retry_suggest_reply" && onSuggestCasualReply) {
                      showToast(isVi ? "🔄 Đang gợi ý lại câu trả lời..." : "🔄 Retrying suggest casual reply...");
                      onSuggestCasualReply(act.payload?.imageDataUrl || null, act.payload?.customPrompt || "");
                    } else if (act.action === "send_message" && act.payload?.message) {
                      onSendMessage(act.payload.message);
                    }
                    scrollToBottom("smooth");
                  }}
                  className={`flex items-start justify-between text-left text-xs rounded-xl py-2.5 px-3.5 transition-all duration-200 shadow-2xs cursor-pointer group ${
                    isNextQ
                      ? "bg-stone-900 hover:bg-stone-800 text-white border border-stone-900 font-bold"
                      : "bg-white hover:bg-stone-900 focus:bg-stone-900 active:bg-stone-900 border border-stone-200 hover:border-stone-900 focus:border-stone-900 text-stone-900 hover:text-white focus:text-white"
                  }`}
                >
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    {isNextQ ? (
                      <ChevronRight className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-amber-500 group-hover:text-amber-400 group-focus:text-amber-400 animate-pulse shrink-0 mt-0.5" />
                    )}

                    {act.action === "select_definition" && act.payload?.definition ? (
                      <div className="flex flex-col gap-1 min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={`inline-block px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase rounded border shrink-0 transition-colors ${
                            isNextQ
                              ? "bg-amber-400 text-stone-950 border-amber-300"
                              : "bg-amber-100/90 text-amber-900 border-amber-200/70 group-hover:bg-amber-400 group-hover:text-stone-950 group-focus:bg-amber-400 group-focus:text-stone-950 group-active:bg-amber-400 group-active:text-stone-950"
                          }`}>
                            {act.payload.partOfSpeech || "sense"}
                          </span>
                          <span className={`font-bold text-xs sm:text-sm transition-colors ${
                            isNextQ
                              ? "text-white"
                              : "text-stone-900 group-hover:text-white group-focus:text-white group-active:text-white"
                          }`}>
                            {act.payload.targetWord || act.payload.word}
                            {act.payload.translation && (
                              <span className={`font-medium ml-1 transition-colors ${
                                isNextQ
                                  ? "text-stone-300"
                                  : "text-stone-600 group-hover:text-stone-300 group-focus:text-stone-300 group-active:text-stone-300"
                              }`}>
                                ({act.payload.translation})
                              </span>
                            )}
                          </span>
                        </div>
                        <p className={`text-xs leading-snug font-normal break-words line-clamp-3 transition-colors ${
                          isNextQ
                            ? "text-stone-200"
                            : "text-stone-700 group-hover:text-stone-200 group-focus:text-stone-200 group-active:text-stone-200"
                        }`}>
                          {act.payload.definition}
                        </p>
                        {act.payload.example && (
                          <p className={`text-[11px] italic line-clamp-1 mt-0.5 font-normal transition-colors ${
                            isNextQ
                              ? "text-amber-200/90"
                              : "text-stone-500 group-hover:text-amber-200/90 group-focus:text-amber-200/90 group-active:text-amber-200/90"
                          }`}>
                            Ex: "{act.payload.example}"
                          </p>
                        )}
                      </div>
                    ) : (
                      <span className={`whitespace-normal break-words leading-relaxed font-semibold min-w-0 flex-1 transition-colors ${
                        isNextQ
                          ? "text-white"
                          : "text-stone-900 group-hover:text-white group-focus:text-white group-active:text-white"
                      }`}>
                        {formatActionLabel(act, isVi)}
                      </span>
                    )}
                  </div>
                  <ChevronRight className={`w-3.5 h-3.5 group-hover:translate-x-0.5 transition-all shrink-0 mt-1 ml-2 ${
                    isNextQ 
                      ? "text-stone-300" 
                      : "text-stone-400 group-hover:text-white group-focus:text-white group-active:text-white"
                  }`} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default React.memo(ChatMessageItem);
