import React, { useState, useMemo } from "react";
import { 
  Volume2, ChevronRight, Check, Sparkles, Clock, Plus
} from "lucide-react";
import { ChatMessage, LLMConfig, TTSConfig, Word } from "../../types";
import { speakText, getLanguageCode } from "../../utils/ttsService";
import FormattedMessage, { findMatchingAction } from "./FormattedMessage";
import QuizImage from "../quiz/QuizImage";
import FlashcardMessageCard from "./FlashcardMessageCard";
import { extractOrGenerateTopicActions } from "../../utils/actionExtractor";
import { t } from "../../config/i18n";
import { getQuizCandidates, getFlashcardCandidates } from "../../utils/spacedRepetition";

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
  onGenerateByTopic?: () => void;
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

function formatActionLabel(act: { label: string; action: string; payload?: any }, currentAppLang: string): string {
  if (!act || !act.label) return "";
  const rawLabel = String(act.label).trim();

  const lower = rawLabel.toLowerCase();

  if (act.action === "view_flashcard" || lower.includes("next flash card") || lower.includes("next flashcard")) {
    return t("action_next_flashcard", currentAppLang);
  }

  if (act.action === "start_quiz" || lower.includes("start quiz") || lower.includes("start vocab quiz") || lower.includes("practice")) {
    return t("chat_practice_start_today_action", currentAppLang);
  }

  if (act.action === "fix_another" || lower === "fix another sentence" || lower.includes("fix another")) {
    return t("action_fix_another_sentence", currentAppLang);
  }

  if (act.action === "suggest_another" || lower === "suggest another casual reply" || lower.includes("suggest another")) {
    return t("action_suggest_another", currentAppLang);
  }

  if (act.action === "copy_text" || act.action === "copy_sentence" || lower.includes("copy fixed sentence") || lower.includes("copy sentence")) {
    return t("action_copy_fixed_sentence", currentAppLang);
  }

  if (act.action === "add_word" || act.action === "confirm_save_word") {
    const word = act.payload?.word || (act as any).word;
    const hint = act.payload?.definition || act.payload?.hint || act.payload?.translation || (act as any).definition || (act as any).hint || (act as any).translation;

    if (word) {
      if (hint && !String(hint).startsWith("Paired with")) {
        return t("action_confirm_add", currentAppLang, { word, translation: hint });
      }
      return t("action_add_to_col", currentAppLang, { word });
    }
  }

  if (act.action === "add_multiplewords" || lower.includes("add all")) {
    const count = act.payload?.words?.length;
    if (count) {
      return t("action_add_all_remaining", currentAppLang, { count: String(count) });
    }
    return t("action_add_all_photo_words", currentAppLang, { count: "" }).replace(/\s*\(\)\s*/, " ");
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
  onGenerateByTopic,
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
  const [addedWordsMap, setAddedWordsMap] = useState<Record<string, boolean>>({});

  const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "en";

  const handleAddSuggestedWord = (wordText: string, hint?: string) => {
    const key = wordText.trim().toLowerCase();
    if (addedWordsMap[key]) return;
    onAddWord(wordText, hint);
    setAddedWordsMap((prev) => ({ ...prev, [key]: true }));
    showToast(t("toast_added_word", currentAppLang, { word: wordText }));
  };

  const isQuizActive = useMemo(() => {
    return messages.some(
      (m) =>
        m.id.startsWith("quiz-") ||
        (m.suggestedActions && m.suggestedActions.some((a) => a.action === "quiz_answer"))
    );
  }, [messages]);

  const isWelcomeMsg = !isUser && msg.id.startsWith("welcome-msg") && !isQuizActive;

  const quizCandidates = useMemo(() => {
    if (!isWelcomeMsg || !words || words.length === 0) return [];
    return getQuizCandidates(words);
  }, [isWelcomeMsg, words]);

  const flashcardCandidates = useMemo(() => {
    if (!isWelcomeMsg || !words || words.length === 0) return [];
    return getFlashcardCandidates(words);
  }, [isWelcomeMsg, words]);

  const hasQuizCandidates = quizCandidates.length >= 2 || (quizCandidates.length > 0 && flashcardCandidates.length === 0);
  const hasFlashcardCandidates = !hasQuizCandidates && flashcardCandidates.length > 0;
  const candidateCount = hasQuizCandidates ? quizCandidates.length : (hasFlashcardCandidates ? flashcardCandidates.length : 0);
  const candidateType = hasQuizCandidates ? "quiz" : (hasFlashcardCandidates ? "flashcard" : null);

  const handleCopy = (textToCopy: string, key: string, toastMessage: string) => {
    navigator.clipboard.writeText(textToCopy);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
    showToast(toastMessage);
  };

  const safeMsgContent = typeof msg.content === "string" ? msg.content : (msg.content ? String(msg.content) : "");

  const displayContent = useMemo(() => {
    if (!msg.fixedSentence || !safeMsgContent) return safeMsgContent;

    // Clean up any leading markdown header or blockquote for polished sentence so it's not rendered twice
    let cleaned = safeMsgContent;
    cleaned = cleaned.replace(/^###\s*✨\s*(?:Polished Sentence|Câu Đã Trau Chuốt):\s*\n*(?:>\s*.*?\n*)+/i, "");
    return cleaned.trim();
  }, [safeMsgContent, msg.fixedSentence]);

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

  const unfilteredActions = useMemo(() => {
    let rawActions: { label: string; action: string; payload?: any }[] = [];

    if (!isUser) {
      const hasQuizOptions = parsedQuizOptions.length >= 2 && parsedQuizOptions.length <= 5;
      
      if (msg.flashcardData) {
        // Flashcard message: strictly top 3 suggested words across the whole deck, plus standard deck navigation actions
        const cardsList = msg.flashcardData.cards && Array.isArray(msg.flashcardData.cards) && msg.flashcardData.cards.length > 0
          ? msg.flashcardData.cards
          : (msg.flashcardData.word ? [msg.flashcardData] : []);

        const top3Suggested: { word: string; hint?: string; translation?: string }[] = [];
        const seenWords = new Set<string>();

        for (const card of cardsList) {
          const suggList = card.suggestedWords || [];
          for (const item of suggList) {
            const wordStr = typeof item === "string" ? item.trim() : (item?.word || "").trim();
            const hintStr = typeof item === "object" ? (item?.hint || item?.relationship || item?.translation || "") : "";
            const transStr = typeof item === "object" ? (item?.translation || "") : "";
            const lower = wordStr.toLowerCase();
            if (wordStr && !seenWords.has(lower)) {
              seenWords.add(lower);
              const isAlreadyInCollection = words && Array.isArray(words) && words.some(
                w => w && typeof w.word === "string" && w.word.trim().toLowerCase() === lower
              );
              if (!isAlreadyInCollection) {
                top3Suggested.push({
                  word: wordStr,
                  hint: hintStr || transStr || undefined,
                  translation: transStr || undefined,
                });
                if (top3Suggested.length >= 3) break;
              }
            }
          }
          if (top3Suggested.length >= 3) break;
        }

        const flashcardWordActions = top3Suggested.map(s => ({
          label: `+ ${s.word}`,
          action: "add_word",
          payload: {
            word: s.word,
            hint: s.hint || s.translation
          }
        }));

        // Keep non-word actions from msg.suggestedActions (e.g. view_flashcard, start_quiz)
        const nonWordActions = (msg.suggestedActions || []).filter(
          a => a && a.action !== "add_word" && a.action !== "confirm_save_word" && a.action !== "add_multiplewords"
        );

        rawActions = [...flashcardWordActions, ...nonWordActions];
      } else if (hasQuizOptions) {
        rawActions = [...parsedQuizOptions];
      } else if (msg.suggestedActions && msg.suggestedActions.length > 0) {
        rawActions = [...msg.suggestedActions];
      }

      // On the latest message, if no quiz options and not flashcard, extract or generate topic choices
      if (isLatestMessage && !hasQuizOptions && !msg.flashcardData) {
        const content = safeMsgContent;
        const lastUserMessage = [...messages].reverse().find(m => m.role === "user")?.content || "";

        rawActions = extractOrGenerateTopicActions(
          content,
          rawActions,
          lastUserMessage,
          targetLanguage,
          nativeLanguage,
          currentAppLang
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
      // Word addition options are moved to the latest message so users don't need to scroll up
      if (!isLatestMessage) {
        rawActions = rawActions.filter(
          a =>
            a.action === "retry_analyze_image" ||
            a.action === "retry_suggest_reply" ||
            a.action === "copy_text" ||
            a.action === "copy_sentence"
        );
      }
    }

    const filtered = (rawActions || []).filter(act => {
      if (!act || typeof act !== "object") return false;
      if (act.action === "select_definition") return Boolean(act.payload?.definition);

      // Filter out add_word or confirm_save_word if word is already in words collection
      if (act.action === "add_word" || act.action === "confirm_save_word") {
        const actWord = (act.payload?.word || act.payload?.targetWord || (act as any).word || "").trim().toLowerCase();
        if (actWord && words && Array.isArray(words) && words.some(w => w.word.trim().toLowerCase() === actWord)) {
          return false;
        }
      }

      // Filter out add_multiplewords if all individual words are already in the collection
      if (act.action === "add_multiplewords" && act.payload && Array.isArray(act.payload.words)) {
        const unsavedCount = act.payload.words.filter((w: any) => {
          const wText = (w?.word || "").trim().toLowerCase();
          return wText && words && Array.isArray(words) && !words.some(x => x.word.trim().toLowerCase() === wText);
        }).length;
        if (unsavedCount === 0) {
          return false;
        }
      }

      const lbl = act.label ? String(act.label).trim() : "";
      const msgPayload = act.payload?.message ? String(act.payload.message).trim() : "";
      const wordPayload = act.payload?.word || (act as any).word ? String(act.payload?.word || (act as any).word).trim() : "";
      return lbl.length > 0 || msgPayload.length > 0 || wordPayload.length > 0;
    });

    const hasOriginalWordConfirmAction = (rawActions || []).some(
      a => a && (a.action === "confirm_save_word" || a.action === "add_word" || a.action === "select_definition")
    );
    const hasRemainingWordConfirmAction = filtered.some(
      a => a && (a.action === "confirm_save_word" || a.action === "add_word" || a.action === "select_definition" || a.action === "add_multiplewords")
    );

    return filtered
      .filter(act => {
        // If this message originally had word confirmation/addition actions and all of them have been resolved/saved,
        // any accompanying cancel action (e.g. "✕ Cancel") should also be removed.
        const isCancelAction =
          (act.action === "send_message" && (act.payload?.message?.toLowerCase() === "cancel" || act.payload?.message?.toLowerCase() === "hủy")) ||
          (typeof act.label === "string" && (act.label.toLowerCase().includes("cancel") || act.label.toLowerCase().includes("hủy")));

        if (isCancelAction && hasOriginalWordConfirmAction && !hasRemainingWordConfirmAction) {
          return false;
        }
        return true;
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
  }, [isUser, parsedQuizOptions, msg.suggestedActions, isLatestMessage, safeMsgContent, messages, targetLanguage, nativeLanguage, words]);

  const effectiveActions = useMemo(() => {
    const lines = (displayContent || "").split("\n");
    const inlineMatchedActions = new Set<{ label: string; action: string; payload?: any }>();
    for (const line of lines) {
      const trimmed = line.trim();
      let content = "";
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        content = trimmed.substring(2);
      } else {
        const numberedMatch = trimmed.match(/^(\d+)\.\s+(.*)/);
        if (numberedMatch) {
          content = numberedMatch[2];
        }
      }
      if (content) {
        const matching = findMatchingAction(content, unfilteredActions);
        if (matching) {
          inlineMatchedActions.add(matching);
        }
      }
    }

    return unfilteredActions.filter(act => !inlineMatchedActions.has(act));
  }, [unfilteredActions, displayContent]);

  const handleActionClick = (act: { label: string; action: string; payload?: any }) => {
    if (act.action === "copy_text" || act.action === "copy_sentence") {
      const textToCopy = act.payload?.text || msg.fixedSentence || "";
      if (textToCopy) {
        navigator.clipboard.writeText(textToCopy);
        showToast(t("toast_copied_selection", currentAppLang));
      }
    } else if (act.action === "suggest_another" || act.action === "suggest_reply") {
      handleRecordActionUse("suggest_reply");
      setIsPhotoModalOpen(true);
      onSuggestCasualReplyPrompt?.();
    } else if (act.action === "fix_another" || act.action === "fix_grammar") {
      handleRecordActionUse("fix_grammar");
      onFixGrammar();
    } else if (act.action === "generate_topic" || act.action === "generate_words") {
      handleRecordActionUse("generate_topic");
      onGenerateByTopic?.();
    } else if (act.action === "confirm_save_word" && act.payload && onAddMultipleWords) {
      onAddMultipleWords([act.payload]);
      showToast(t("toast_added_word", currentAppLang, { word: act.payload.word }));
    } else if (act.action === "add_word") {
      handleRecordActionUse("add_word");
      if (act.payload?.word) {
        onAddWord(act.payload.word, act.payload?.hint);
      } else {
        onAddWord();
      }
    } else if (act.action === "add_multiplewords" && act.payload?.words && onAddMultipleWords) {
      onAddMultipleWords(act.payload.words);
      showToast(t("toast_added_multiple_words", currentAppLang, { count: String(act.payload.words.length) }));
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
        showToast(t("toast_retrying_photo_analysis", currentAppLang));
        onAnalyzeImageVocab(imageToRetry, act.payload?.customPrompt);
      } else {
        showToast(t("toast_photo_upload_prompt", currentAppLang));
        setIsPhotoModalOpen(true);
      }
    } else if (act.action === "retry_suggest_reply" && onSuggestCasualReply) {
      showToast(t("toast_retrying_suggest_reply", currentAppLang));
      onSuggestCasualReply(act.payload?.imageDataUrl || null, act.payload?.customPrompt || "");
    } else if (act.action === "send_message" && act.payload?.message) {
      onSendMessage(act.payload.message);
    }
    scrollToBottom("smooth");
  };

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
              onAddWord={onAddWord}
              onAddMultipleWords={onAddMultipleWords}
              showToast={showToast}
            />
          ) : (
            <>
              {/* Fixed sentence copy card at the top */}
              {msg.fixedSentence && (
                <div className="mb-3 p-3.5 bg-amber-50/90 border border-amber-200/90 rounded-xl flex items-center justify-between gap-3 shadow-2xs">
                  <div className="min-w-0 flex-1">
                    <span className="text-[10px] font-bold text-amber-900 uppercase tracking-wider block font-mono">
                      {t("polished_sentence", currentAppLang)}
                    </span>
                    <p className="text-xs sm:text-sm font-semibold text-stone-900 break-words mt-0.5">
                      "{msg.fixedSentence}"
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(msg.fixedSentence!, `fixed-${msg.id}`, t("toast_copied_fixed_sentence", currentAppLang))}
                    className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-amber-400 font-bold text-xs rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shrink-0 shadow-2xs hover:scale-105 active:scale-95"
                    title={t("action_copy_fixed_sentence", currentAppLang)}
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{copiedKey === `fixed-${msg.id}` ? t("copied", currentAppLang) : t("copy", currentAppLang)}</span>
                  </button>
                </div>
              )}

              <FormattedMessage
                text={displayContent}
                suggestedActions={unfilteredActions}
                onActionClick={handleActionClick}
                appLanguage={currentAppLang}
              />

              {/* Frequently Paired Words (Collocations) Card on Quiz Finish */}
              {msg.quizFinishedData?.suggestedWords && msg.quizFinishedData.suggestedWords.length > 0 && (
                <div className="mt-4 pt-3.5 border-t border-stone-200/80 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <div className="w-5 h-5 rounded-md bg-amber-500 text-stone-950 flex items-center justify-center font-bold text-xs">
                        💡
                      </div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-stone-900 font-mono flex items-center gap-1.5">
                        {t("quiz_suggested_words_title", currentAppLang)}
                        <span className="text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300/60 px-1.5 py-0.2 rounded-full">
                          {msg.quizFinishedData.suggestedWords.length}
                        </span>
                      </h4>
                    </div>
                  </div>
                  <p className="text-xs text-stone-600 font-medium">
                    {t("quiz_suggested_words_desc", currentAppLang)}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    {msg.quizFinishedData.suggestedWords.map((sw, idx) => {
                      const isAlreadyInWords = words?.some(
                        (w) => w.word.trim().toLowerCase() === sw.word.trim().toLowerCase()
                      ) || addedWordsMap[sw.word.trim().toLowerCase()];

                      return (
                        <div
                          key={idx}
                          className="p-3 bg-stone-50/90 hover:bg-stone-50 border border-stone-200/90 rounded-xl flex flex-col justify-between gap-2 transition-all shadow-3xs"
                        >
                          <div>
                            <div className="flex items-start justify-between gap-1.5">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-sm font-bold text-stone-950 font-serif">
                                    {sw.word}
                                  </span>
                                  {sw.partOfSpeech && (
                                    <span className="text-[9px] font-bold uppercase bg-stone-200 text-stone-700 px-1 py-0.2 rounded">
                                      {sw.partOfSpeech}
                                    </span>
                                  )}
                                </div>
                                {sw.translation && (
                                  <p className="text-xs font-semibold text-amber-900 mt-0.5">
                                    "{sw.translation}"
                                  </p>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => speakText(sw.word, ttsConfig, llmConfig, getLanguageCode(targetLanguage))}
                                className="p-1.5 bg-white hover:bg-stone-200 text-stone-700 rounded-lg border border-stone-200/70 shrink-0 cursor-pointer shadow-3xs transition-transform hover:scale-105 active:scale-95"
                                title={`Pronounce "${sw.word}"`}
                              >
                                <Volume2 className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {sw.pairedWith && (
                              <div className="mt-1.5 flex items-center gap-1 text-[11px] text-stone-500 font-mono">
                                <span className="text-stone-400">🔗</span>
                                <span>{t("quiz_paired_with", currentAppLang, { word: sw.pairedWith })}</span>
                              </div>
                            )}

                            {sw.hint && !sw.hint.toLowerCase().startsWith("frequently appears with") && (
                              <p className="text-[11px] text-stone-600 mt-1 italic leading-tight">
                                {sw.hint}
                              </p>
                            )}
                          </div>

                          <div className="pt-2 border-t border-stone-200/60 flex items-center justify-end">
                            <button
                              type="button"
                              disabled={Boolean(isAlreadyInWords)}
                              onClick={() => handleAddSuggestedWord(sw.word, sw.translation || sw.hint)}
                              className={`px-2.5 py-1 text-xs font-bold rounded-lg flex items-center gap-1 transition-all cursor-pointer ${
                                isAlreadyInWords
                                  ? "bg-emerald-100 text-emerald-850 cursor-default"
                                  : "bg-stone-900 hover:bg-stone-800 text-white shadow-3xs active:scale-95"
                              }`}
                            >
                              {isAlreadyInWords ? (
                                <>
                                  <Check className="w-3 h-3" />
                                  <span>{t("quiz_suggested_word_added", currentAppLang)}</span>
                                </>
                              ) : (
                                <>
                                  <Plus className="w-3 h-3" />
                                  <span>{t("quiz_add_suggested_word", currentAppLang)}</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
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
              {/* Candidate Words Ready Banner (Shown when starting a new chat) */}
              {isWelcomeMsg && candidateType && candidateCount > 0 && (
                <div className="mt-4 pt-3.5 border-t border-stone-200/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-stone-50/90 -mx-4 -mb-4 p-4 rounded-b-2xl">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 font-bold text-sm shadow-2xs ${
                      candidateType === "quiz" ? "bg-amber-100 text-amber-900 border border-amber-200/60" : "bg-blue-100 text-blue-900 border border-blue-200/60"
                    }`}>
                      {candidateType === "quiz" ? "🧠" : "🎴"}
                    </div>
                    <div className="min-w-0">
                      <span className={`text-[10px] font-bold uppercase tracking-wider block font-mono ${
                        candidateType === "quiz" ? "text-amber-900" : "text-blue-900"
                      }`}>
                        {t(candidateType === "quiz" ? "chat_quiz_candidates_header" : "chat_flashcard_candidates_header", currentAppLang)}
                      </span>
                      <p className="text-xs font-semibold text-stone-800 truncate">
                        {t(
                          candidateType === "quiz"
                            ? (candidateCount === 1 ? "chat_word_ready_quiz" : "chat_words_ready_quiz")
                            : (candidateCount === 1 ? "chat_word_ready_flashcard" : "chat_words_ready_flashcard"),
                          currentAppLang,
                          { count: String(candidateCount) }
                        )}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (candidateType === "quiz") {
                        handleRecordActionUse("start_quiz");
                        onStartQuiz();
                      } else {
                        handleRecordActionUse("view_flashcard");
                        if (onViewFlashcard) onViewFlashcard();
                        else onStartQuiz();
                      }
                    }}
                    className="w-full sm:w-auto px-3.5 py-1.5 bg-stone-900 hover:bg-stone-800 text-amber-400 font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shrink-0 shadow-2xs hover:scale-102 active:scale-98"
                  >
                    <span>
                      {t(candidateType === "quiz" ? "chat_practice_now_btn" : "chat_review_flashcards_btn", currentAppLang)}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
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
                  onClick={() => handleActionClick(act)}
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
                        {formatActionLabel(act, currentAppLang)}
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
