import React, { useState, useMemo } from "react";
import { AnimatePresence } from "motion/react";
import { 
  Volume2, ChevronRight, Check, Sparkles, Plus, History, MessageSquare, Lock, CheckCircle2, Swords, BookOpen
} from "lucide-react";
import { ChatMessage, LLMConfig, TTSConfig, Word, QuizSuggestedWord } from "../../types";
import { speakText, getLanguageCode } from "../../utils/ttsService";
import FormattedMessage, { findMatchingAction } from "./FormattedMessage";
import LlmResponseMetadata from "./LlmResponseMetadata";
import QuizImage from "../quiz/QuizImage";
import StoryImmersionMessageCard from "./StoryImmersionMessageCard";
import ChatErrorMessageCard from "./ChatErrorMessageCard";
import { WordLibraryChatCard } from "./WordLibraryChatCard";
import { WordAddGalleryPreview } from "./WordAddGalleryPreview";
import WordChatModal from "./WordChatModal";
import { extractOrGenerateTopicActions } from "../../utils/actionExtractor";
import { isWordInCollection, findWordInCollection, isNoun, isPhrasalVerb } from "../../utils/wordNormalization";
import { t } from "../../config/i18n";
import { getAllPracticeCandidates } from "../../utils/spacedRepetition";
import StrengthHistoryModal from "../analytics/StrengthHistoryModal";
import WordReviewedBanner from "./WordReviewedBanner";

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
  onAddWord: (word?: string, hint?: string, extraData?: Partial<Word>) => void;
  onAddMultipleWords?: (words: any[]) => void;
  onGenerateByTopic?: () => void;
  startPractice: (
    overrideConfig?: any,
    mode?: "auto" | "story_immersion" | "quiz_only" | "balanced" | "sandwich_quiz" | "sandwich_duel" | "confuser_duel",
    options?: { warmupWordIds?: string[] }
  ) => void;
  onFixGrammar: () => void;
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
  onRetryErrorMessage?: (messageId: string) => void;
  onCancelErrorMessage?: (messageId: string) => void;
  hideAskAiButton?: boolean;
}

const createAdHocWord = (overrides: Partial<Word> & { word: string }): Word => ({
  id: overrides.id || `adhoc-${Date.now()}`,
  word: overrides.word,
  pronunciation: overrides.pronunciation || undefined,
  partOfSpeech: overrides.partOfSpeech || "expression",
  definition: overrides.definition || "",
  translation: overrides.translation || "",
  example: overrides.example || undefined,
  exampleTranslation: overrides.exampleTranslation || undefined,
  learned: overrides.learned ?? false,
  starred: overrides.starred ?? false,
  createdAt: overrides.createdAt || new Date().toISOString(),
  lastReviewed: overrides.lastReviewed ?? null,
  strength: overrides.strength ?? 0,
  category: overrides.category,
  context: overrides.context,
  imageUrl: overrides.imageUrl,
  imageUrls: overrides.imageUrls,
});

function formatActionLabel(act: { label: string; action: string; payload?: any }, currentAppLang: string): string {
  if (!act || !act.label) return "";
  const rawLabel = String(act.label).trim();

  const lower = rawLabel.toLowerCase();

  if (act.action === "next_quiz" || lower === "next quiz" || lower === "🏆 next quiz") {
    return t("action_next_quiz", currentAppLang);
  }

  if (act.action === "start_sandwich_duel" || lower.includes("start confuser duel")) {
    return t("chat_sandwich_start_duel_action", currentAppLang);
  }

  if (act.action === "start_sandwich_quiz" || lower.includes("start practice quiz")) {
    return t("chat_sandwich_start_quiz_action", currentAppLang);
  }

  if (act.action === "start_practice" && (lower === "start practice" || lower.includes("start practice"))) {
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
  startPractice,
  onFixGrammar,
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
  onRetryErrorMessage,
  onCancelErrorMessage,
  hideAskAiButton,
}: ChatMessageItemProps) {
  if (msg.isError) {
    return (
      <ChatErrorMessageCard
        msg={msg}
        appLanguage={appLanguage}
        llmConfig={llmConfig}
        onRetry={() => onRetryErrorMessage?.(msg.id)}
        onCancel={() => onCancelErrorMessage?.(msg.id)}
      />
    );
  }

  const isUser = msg.role === "user";
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [selectedHistoryWord, setSelectedHistoryWord] = useState<Word | null>(null);
  const [selectedChatWord, setSelectedChatWord] = useState<Word | null>(null);

  const currentAppLang = appLanguage || localStorage.getItem("vocab_learner_app_lang") || nativeLanguage || "en";

  const handleAddSuggestedWord = (wordText: string, hint?: string, extraData?: Partial<Word>) => {
    const isAlreadyInWords = words && isWordInCollection(words, wordText);
    if (isAlreadyInWords) return;
    onAddWord(wordText, hint, extraData);
  };

  const handleModalWordUpdate = (updated: Word) => {
    setSelectedHistoryWord((prev) => (prev ? updated : null));
    if (onUpdateWords && words) {
      const nextWords = words.map((w) => (w.id === updated.id ? updated : w));
      onUpdateWords(nextWords);
    }
  };

  const answeredWord = useMemo(() => {
    if (!msg.answeredQuizWordId) return null;
    return (words || []).find((w) => w.id === msg.answeredQuizWordId);
  }, [words, msg.answeredQuizWordId]);

  const safeMsgContent = typeof msg.content === "string" ? msg.content : (msg.content ? String(msg.content) : "");

  const displayContent = useMemo(() => {
    if (!msg.fixedSentence || !safeMsgContent) return safeMsgContent;

    // Clean up any leading markdown header or blockquote for polished sentence so it's not rendered twice
    let cleaned = safeMsgContent;
    cleaned = cleaned.replace(/^###\s*✨\s*(?:Polished Sentence|Câu Đã Trau Chuốt):\s*\n*(?:>\s*.*?\n*)+/i, "");
    return cleaned.trim();
  }, [safeMsgContent, msg.fixedSentence]);

  const { feedbackPart, nextQuestionPart } = useMemo(() => {
    if (!answeredWord || !displayContent) {
      return { feedbackPart: displayContent, nextQuestionPart: null };
    }
    const match = displayContent.match(/\n+\s*---\s*\n+/);
    if (match && match.index !== undefined) {
      const feedbackPart = displayContent.substring(0, match.index).trim();
      const nextQuestionPart = displayContent.substring(match.index + match[0].length).trim();
      return { feedbackPart, nextQuestionPart };
    }
    return { feedbackPart: displayContent, nextQuestionPart: null };
  }, [displayContent, answeredWord]);

  const isQuizActive = useMemo(() => {
    return messages.some(
      (m) =>
        m.id.startsWith("quiz-") ||
        (m.suggestedActions && m.suggestedActions.some((a) => a.action === "quiz_answer"))
    );
  }, [messages]);

  // Determine suggested words: from msg.suggestedWords, msg.quizFinishedData.suggestedWords,
  // or derived from any 'add_word' actions or quiz feedback content so they are ALWAYS rendered INSIDE the message bubble!
  const effectiveSuggestedWords = useMemo<QuizSuggestedWord[]>(() => {
    if (msg.suggestedWords && msg.suggestedWords.length > 0) {
      return msg.suggestedWords;
    }
    if (msg.quizFinishedData?.suggestedWords && msg.quizFinishedData.suggestedWords.length > 0) {
      return msg.quizFinishedData.suggestedWords;
    }
    const addWordActions = (msg.suggestedActions || []).filter(
      (a) => a && a.action === "add_word" && a.payload && (a.payload.word || (a as any).word)
    );
    if (addWordActions.length > 0) {
      return addWordActions.map((a) => {
        const p = a.payload || {};
        const wordText = String(p.word || (a as any).word || "").trim();
        return {
          word: wordText,
          translation: p.translation || "",
          definition: p.definition || "",
          hint: p.hint || (a.label ? a.label.replace(/^\+\s*(?:Add\s*(?:word\s*)?)?["']?/i, "").replace(/["']?$/i, "") : ""),
          partOfSpeech: p.partOfSpeech,
          pairedWith: p.pairedWith,
        };
      });
    }

    // Safety fallback for quiz feedback messages: extract contrast rival or collocations from feedback content if missing
    if (msg.id.startsWith("quiz-feedback-") && msg.content) {
      const derived: QuizSuggestedWord[] = [];
      const targetWord = msg.audioWord || "";

      let rivalWord = msg.confuserWord;
      let contrastText = msg.contrastRule || "";

      if (!rivalWord) {
        // Try extracting from content: e.g. Contrast Match & Unlearning Rule: 'Liaise' means ... while 'mediate' means ...
        const contrastMatch = msg.content.match(/(?:Contrast Match & Unlearning Rule:?|Contrast Duel:?)\s*([^\n]+)/i);
        if (contrastMatch && contrastMatch[1]) {
          contrastText = contrastMatch[1];
          const wordsInQuotes = Array.from(contrastText.matchAll(/['"“]([a-zA-ZÀ-ỹ\s-]+)['"”]/g)).map(m => m[1].trim());
          const otherWord = wordsInQuotes.find(w => targetWord && w.toLowerCase() !== targetWord.toLowerCase());
          if (otherWord) {
            rivalWord = otherWord;
          }
        }
      }

      if (rivalWord && (!targetWord || rivalWord.toLowerCase() !== targetWord.toLowerCase())) {
        let cleanRivalDef = "";
        if (contrastText) {
          const escapedRival = rivalWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          const m = contrastText.match(
            new RegExp(`(?:while|whereas)?\\s*(?:a|an)?\\s*['"]?${escapedRival}['"]?\\s*(?:refers to|means|is defined as|denotes|is)\\s*([^.;]+)`, "i")
          );
          if (m && m[1]) {
            cleanRivalDef = m[1].trim();
          } else {
            cleanRivalDef = contrastText;
          }
        }
        derived.push({
          word: rivalWord,
          translation: "",
          definition: cleanRivalDef,
          pairedWith: targetWord || undefined,
        });
      }

      // Check for preposition collocation in the sentence in msg.content
      if (targetWord) {
        const escapedWord = targetWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const prepMatch = msg.content.match(new RegExp(`\\b(${escapedWord})\\s+(with|to|for|on|in|about|from|at|into|up|out|down|of|off|by|between)\\b`, "i"));
        if (prepMatch && prepMatch[0]) {
          const combo = prepMatch[0].trim();
          if (!derived.some(d => d.word.toLowerCase() === combo.toLowerCase())) {
            derived.push({
              word: combo,
              translation: "",
              definition: "",
              partOfSpeech: "collocation",
              pairedWith: targetWord,
            });
          }
        }
      }

      if (derived.length > 0) {
        return derived;
      }
    }

    return [];
  }, [msg.suggestedWords, msg.quizFinishedData?.suggestedWords, msg.suggestedActions, msg.id, msg.content, msg.confuserWord, msg.contrastRule, msg.audioWord]);

  const isWelcomeMsg = !isUser && msg.id.startsWith("welcome-msg") && !isQuizActive;

  const activeSandwichWarmupMsg = useMemo(() => {
    return messages.find(
      (m) =>
        (m.id.startsWith("sandwich-warmup-msg-") ||
          m.id.startsWith("sandwich-warmup-story-") ||
          (m.suggestedActions && m.suggestedActions.some((a) => a?.action === "start_sandwich_duel" || a?.action === "start_sandwich_quiz"))) &&
        !messages.some((quizM) => quizM.id.startsWith("sandwich-duel-start-") || quizM.id.startsWith("sandwich-quiz-start-") || quizM.quizFinishedData)
    );
  }, [messages]);

  const { totalWarmupCards, reviewedWarmupCount, isAllWarmupReviewed, remainingWarmupToReview } = useMemo(() => {
    return { totalWarmupCards: 1, reviewedWarmupCount: 1, isAllWarmupReviewed: true, remainingWarmupToReview: 0 };
  }, [activeSandwichWarmupMsg]);

  const practiceCandidates = useMemo(() => {
    if (!isWelcomeMsg || !words || words.length === 0) return [];
    return getAllPracticeCandidates(words);
  }, [isWelcomeMsg, words]);

  const candidateCount = practiceCandidates.length;

  // Practice & Quiz image rule: only show images for words that are nouns
  const shouldShowQuizImage = useMemo(() => {
    if (!msg.imageUrl && !msg.imageKeyword) return false;
    // User-uploaded photo or camera captures (data: or blob:) are not practice/quiz images
    if (msg.imageUrl && (msg.imageUrl.startsWith("data:") || msg.imageUrl.startsWith("blob:"))) {
      return true;
    }
    // For practice/quiz questions: strictly enforce noun check
    if (msg.partOfSpeech) {
      return isNoun(msg.partOfSpeech);
    }
    const candidateWordText = msg.audioWord || msg.imageKeyword || "";
    if (candidateWordText && words && words.length > 0) {
      const foundWord = findWordInCollection(words, candidateWordText) || words.find(w => w.word.toLowerCase() === candidateWordText.toLowerCase());
      if (foundWord?.partOfSpeech) {
        return isNoun(foundWord.partOfSpeech);
      }
    }
    return false;
  }, [msg.imageUrl, msg.imageKeyword, msg.partOfSpeech, msg.audioWord, words]);

  const handleCopy = (textToCopy: string, key: string, toastMessage: string) => {
    navigator.clipboard.writeText(textToCopy);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
    showToast(toastMessage);
  };

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
      
      if (hasQuizOptions) {
        rawActions = [...parsedQuizOptions];
      } else if (msg.suggestedActions && msg.suggestedActions.length > 0) {
        if (msg.quizFinishedData) {
          rawActions = msg.suggestedActions.map(a => {
            if (a && (a.action === "start_practice" || a.action === "start_practice_quiz_only" || a.action === "next_quiz")) {
              return {
                ...a,
                action: "next_quiz",
                label: t("action_next_quiz", currentAppLang)
              };
            }
            return a;
          });
        } else {
          rawActions = [...msg.suggestedActions];
        }
      }

      // On the latest message, if no quiz options and not story, extract or generate topic choices
      if (isLatestMessage && !hasQuizOptions && !msg.storyData) {
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
      // Word addition options are moved to the latest message so users don't need to scroll up,
      // but practice session flow actions remain visible so users can continue practice sessions.
      if (!isLatestMessage) {
        rawActions = rawActions.filter(
          a =>
            a.action === "retry_analyze_image" ||
            a.action === "retry_suggest_reply" ||
            a.action === "copy_text" ||
            a.action === "copy_sentence" ||
            a.action === "start_practice_balanced" ||
            a.action === "start_practice_quiz_only" ||
            a.action === "start_practice_confuser_duel" ||
            a.action === "start_practice" ||
            a.action === "next_quiz"
        );
      }

      // During a smart balanced review session, when a new word is added or thread advances,
      // consistently move the "Start Confuser Duel" (Step 2) or "Start Practice Quiz" (Step 3) button
      // to appear ONLY after the final (latest) message, never duplicating onto previous messages.
      if (isLatestMessage) {
        const duelAlreadyStarted = messages.some(quizM => quizM.id.startsWith("sandwich-duel-start-"));
        const quizAlreadyStarted = messages.some(quizM => quizM.id.startsWith("sandwich-quiz-start-"));

        if (!quizAlreadyStarted) {
          let actionToPromote: { action: string; payload?: any } | undefined;

          if (duelAlreadyStarted) {
            // Once duel has started/finished, only promote the quiz step
            for (let i = messages.length - 1; i >= 0; i--) {
              const qAction = messages[i].suggestedActions?.find(a => a && a.action === "start_sandwich_quiz");
              if (qAction) {
                actionToPromote = qAction;
                break;
              }
            }
          } else {
            // Duel has not started yet, promote the duel step
            for (let i = messages.length - 1; i >= 0; i--) {
              const dAction = messages[i].suggestedActions?.find(a => a && a.action === "start_sandwich_duel");
              if (dAction) {
                actionToPromote = dAction;
                break;
              }
            }
          }

          if (actionToPromote) {
            let actionPayload = actionToPromote.payload?.warmupWordIds
              ? actionToPromote.payload
              : undefined;

            if (!actionPayload || !Array.isArray(actionPayload.warmupWordIds) || actionPayload.warmupWordIds.length === 0) {
              const warmupMsg = messages.find(
                m => m.id.startsWith("sandwich-warmup-msg-") || m.id.startsWith("sandwich-warmup-story-")
              );
              const origAction = warmupMsg?.suggestedActions?.find(
                a => a?.action === "start_sandwich_quiz" || a?.action === "start_sandwich_duel"
              );
              actionPayload = origAction?.payload?.warmupWordIds
                ? origAction.payload
                : { warmupWordIds: [] };
            }

            const promotedAction = {
              label:
                actionToPromote.action === "start_sandwich_duel"
                  ? t("chat_sandwich_start_duel_action", currentAppLang)
                  : t("chat_sandwich_start_quiz_action", currentAppLang),
              action: actionToPromote.action,
              payload: actionPayload,
            };

            const existingIdx = rawActions.findIndex(
              a => a && (a.action === "start_sandwich_duel" || a.action === "start_sandwich_quiz")
            );
            if (existingIdx >= 0) {
              rawActions[existingIdx] = promotedAction;
            } else {
              rawActions.push(promotedAction);
            }
          }
        }
      }
    }

    const filtered = (rawActions || []).filter(act => {
      if (!act || typeof act !== "object") return false;
      if (act.action === "select_definition") return Boolean(act.payload?.definition);

      // Suggested words are ALWAYS rendered inside the chat message bubble, never below the message
      if (act.action === "add_word") {
        return false;
      }

      // Filter out confirm_save_word if word is already in words collection
      if (act.action === "confirm_save_word") {
        const actWord = (act.payload?.word || act.payload?.targetWord || (act as any).word || "").trim();
        if (actWord && words && Array.isArray(words) && isWordInCollection(words, actWord)) {
          return false;
        }
      }

      // Filter out add_multiplewords if all individual words are already in the collection
      if (act.action === "add_multiplewords" && act.payload && Array.isArray(act.payload.words)) {
        const unsavedCount = act.payload.words.filter((w: any) => {
          const wText = (w?.word || "").trim();
          return wText && words && Array.isArray(words) && !isWordInCollection(words, wText);
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

    const seenActionKeys = new Set<string>();
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

        // Deduplicate actions by action type (for session actions) or action+label
        if (act.action === "start_sandwich_duel" || act.action === "start_sandwich_quiz") {
          const sessionStepKey = `session_step_${act.action}`;
          if (seenActionKeys.has(sessionStepKey)) return false;
          seenActionKeys.add(sessionStepKey);
        } else {
          const dedupeKey = `${act.action}:${act.label || ""}:${JSON.stringify(act.payload || {})}`;
          if (seenActionKeys.has(dedupeKey)) return false;
          seenActionKeys.add(dedupeKey);
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
  }, [
    isUser,
    parsedQuizOptions,
    msg.suggestedActions,
    msg.quizFinishedData,
    isLatestMessage,
    msg.storyData,
    safeMsgContent,
    messages,
    targetLanguage,
    nativeLanguage,
    words,
    currentAppLang
  ]);

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

  const [customActionPayloads, setCustomActionPayloads] = useState<Record<number, any>>({});

  const handleActionClick = (act: { label: string; action: string; payload?: any }, actionIndex?: number) => {
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
      const payloadToUse = (actionIndex !== undefined && customActionPayloads[actionIndex]) || act.payload;
      onAddMultipleWords([payloadToUse]);
    } else if (act.action === "add_word") {
      handleRecordActionUse("add_word");
      if (act.payload?.word) {
        onAddWord(act.payload.word, act.payload?.hint, act.payload);
      } else {
        onAddWord();
      }
    } else if (act.action === "add_multiplewords" && act.payload?.words && onAddMultipleWords) {
      onAddMultipleWords(act.payload.words);
      showToast(t("toast_added_multiple_words", currentAppLang, { count: String(act.payload.words.length) }));
    } else if (act.action === "start_practice") {
      handleRecordActionUse("start_practice");
      startPractice();
    } else if (act.action === "start_practice_quiz_only" || act.action === "next_quiz") {
      handleRecordActionUse("start_practice");
      startPractice(undefined, "quiz_only");
    } else if (act.action === "start_practice_balanced") {
      handleRecordActionUse("start_practice");
      startPractice(undefined, "balanced");
    } else if (act.action === "start_practice_confuser_duel") {
      handleRecordActionUse("start_practice");
      startPractice(undefined, "confuser_duel");
    } else if (
      act.action === "start_practice_story_immersion" ||
      act.action === "start_story_immersion" ||
      act.action === "next_story"
    ) {
      handleRecordActionUse("start_practice");
      startPractice(undefined, "story_immersion");
    } else if (act.action === "start_sandwich_duel") {
      handleRecordActionUse("start_practice");
      let warmupWordIds = act.payload?.warmupWordIds;
      if (!warmupWordIds || !Array.isArray(warmupWordIds) || warmupWordIds.length === 0) {
        const warmupMsg = messages.find(m => m.id.startsWith("sandwich-warmup-msg-") || m.id.startsWith("sandwich-warmup-story-"));
        const origAction = warmupMsg?.suggestedActions?.find(a => a?.action === "start_sandwich_duel" || a?.action === "start_sandwich_quiz");
        warmupWordIds = origAction?.payload?.warmupWordIds || [];
      }
      startPractice(undefined, "sandwich_duel", { warmupWordIds });
    } else if (act.action === "start_sandwich_quiz") {
      handleRecordActionUse("start_practice");
      let warmupWordIds = act.payload?.warmupWordIds;
      if (!warmupWordIds || !Array.isArray(warmupWordIds) || warmupWordIds.length === 0) {
        const warmupMsg = messages.find(m => m.id.startsWith("sandwich-warmup-msg-") || m.id.startsWith("sandwich-warmup-story-"));
        const origAction = warmupMsg?.suggestedActions?.find(a => a?.action === "start_sandwich_quiz" || a?.action === "start_sandwich_duel");
        warmupWordIds = origAction?.payload?.warmupWordIds || [];
      }
      startPractice(undefined, "sandwich_quiz", { warmupWordIds });
    } else if (act.action === "quiz_answer" && act.payload?.answer) {
      onSendMessage(act.payload.answer);
      return;
    } else if (act.action === "next_quiz_question") {
      onSendMessage("__next_quiz_question__");
      return;
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
      <div className="space-y-2 w-full flex flex-col">
        <div 
          className={
            msg.storyData
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
          ) : msg.storyData ? (
            <StoryImmersionMessageCard
              story={msg.storyData}
              targetLanguage={targetLanguage}
              nativeLanguage={nativeLanguage}
              appLanguage={currentAppLang}
              ttsConfig={ttsConfig}
              llmConfig={llmConfig}
              provider={msg.storyData?.provider || msg.provider}
              model={msg.storyData?.model || msg.model}
              responseTimeMs={msg.storyData?.responseTimeMs ?? msg.responseTimeMs}
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
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!hideAskAiButton && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedChatWord(createAdHocWord({
                            id: `sentence-fixed-${msg.id}`,
                            word: msg.fixedSentence!,
                            definition: `Polished sentence in ${targetLanguage}`,
                            translation: "",
                            category: "Grammar & Expression",
                            context: `Polished sentence from chat session`,
                            strength: 100,
                            learned: true,
                            createdAt: new Date().toISOString(),
                            lastReviewed: null
                          }));
                        }}
                        className="px-2.5 py-1.5 bg-white hover:bg-stone-100 text-stone-800 font-bold text-xs rounded-lg border border-amber-300/80 transition-all flex items-center gap-1.5 cursor-pointer shadow-3xs hover:scale-105 active:scale-95"
                        title="Ask AI about this sentence"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-indigo-600" />
                        <span>Ask AI</span>
                      </button>
                    )}
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
                </div>
              )}



              <FormattedMessage
                text={feedbackPart}
                suggestedActions={nextQuestionPart ? undefined : unfilteredActions}
                onActionClick={handleActionClick}
                appLanguage={currentAppLang}
                onPlayAudio={(textToPlay) => speakText(textToPlay, ttsConfig, llmConfig, getLanguageCode(targetLanguage))}
                targetWord={answeredWord?.word}
              />

              {/* Word Strength History banner shown AFTER user answers the quiz question (placed between feedback and next question) */}
              {answeredWord && (
                <WordReviewedBanner
                  word={answeredWord}
                  onPlayAudio={(text) => speakText(text, ttsConfig, llmConfig, getLanguageCode(targetLanguage))}
                  onAskAi={!hideAskAiButton ? (w) => setSelectedChatWord(w) : undefined}
                  onViewHistory={(w) => setSelectedHistoryWord(w)}
                />
              )}

              {nextQuestionPart && (
                <>
                  <div className="my-3 border-t border-stone-200/80" />
                  <FormattedMessage
                    text={nextQuestionPart}
                    suggestedActions={unfilteredActions}
                    onActionClick={handleActionClick}
                    appLanguage={currentAppLang}
                    onPlayAudio={(textToPlay) => speakText(textToPlay, ttsConfig, llmConfig, getLanguageCode(targetLanguage))}
                    targetWord={answeredWord?.word}
                  />
                </>
              )}

              {/* Word Libraries List Card */}
              {msg.wordLibraries && (
                <WordLibraryChatCard
                  targetLanguage={targetLanguage}
                  nativeLanguage={nativeLanguage}
                  appLanguage={currentAppLang}
                  showToast={showToast}
                  onAddWord={onAddWord}
                  onAddMultipleWords={onAddMultipleWords}
                  onGenerateByTopic={onGenerateByTopic}
                  words={words}
                  ttsConfig={ttsConfig}
                  llmConfig={llmConfig}
                />
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
                          <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
                            {!hideAskAiButton && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedChatWord(createAdHocWord({
                                    id: `reply-${msg.id}-${idx}`,
                                    word: rep.reply,
                                    definition: rep.explanation || rep.translation || `Suggested reply in ${targetLanguage}`,
                                    translation: rep.translation || "",
                                    category: "Conversation Reply",
                                    context: rep.tone ? `Tone: ${rep.tone}` : undefined,
                                    strength: 100,
                                    learned: true,
                                    createdAt: new Date().toISOString(),
                                    lastReviewed: null
                                  }));
                                }}
                                className="px-2.5 py-1.5 bg-white hover:bg-stone-100 text-stone-800 font-bold text-xs rounded-lg border border-amber-300/80 transition-all flex items-center gap-1.5 cursor-pointer shadow-3xs hover:scale-105 active:scale-95"
                                title="Ask AI about this reply"
                              >
                                <MessageSquare className="w-3.5 h-3.5 text-indigo-600" />
                                <span>Ask AI</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleCopy(rep.reply, repKey, "📋 Copied suggestion to clipboard!")}
                              className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-amber-400 font-bold text-xs rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shrink-0 shadow-2xs hover:scale-105 active:scale-95"
                              title="Copy suggestion to clipboard"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>{isCopied ? "Copied!" : "Copy"}</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Image for visual picture questions or photo analysis (strictly nouns for practice/quiz) */}
              {shouldShowQuizImage && (
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

              {/* Audio clip player card for listening questions (hidden if WordReviewedBanner is shown) */}
              {msg.audioWord && !answeredWord && (
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
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => speakText(msg.audioWord!, ttsConfig, llmConfig, getLanguageCode(targetLanguage))}
                      className="px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-amber-400 font-bold text-xs rounded-lg transition-all flex items-center gap-1.5 cursor-pointer shrink-0 shadow-2xs"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      Play Clip
                    </button>
                  </div>
                </div>
              )}

              {/* Suggested Words / Vocabulary Card - Simple, clean: word + translation or definition */}
              {effectiveSuggestedWords.length > 0 && (
                <div className="mt-3.5 pt-3 border-t border-stone-200/80 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs">💡</span>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-stone-900 font-mono flex items-center gap-1.5">
                        {t("quiz_suggested_words_title", currentAppLang)}
                        <span className="text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300/60 px-1.5 py-0.2 rounded-full">
                          {effectiveSuggestedWords.length}
                        </span>
                      </h4>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-0.5">
                    {effectiveSuggestedWords.map((sw, idx) => {
                      const isAlreadyInWords = words && isWordInCollection(words, sw.word);

                      // Priority: Clean translation (in native language) -> Clean definition
                      const cleanTranslation = (sw.translation || "").trim().replace(/^["“]|["”]$/g, "");
                      let cleanDefinition = (sw.definition || "").trim().replace(/^["“]|["”]$/g, "");
                      if (
                        cleanDefinition.startsWith("Contrast rival against") ||
                        cleanDefinition.startsWith("Common collocation with") ||
                        cleanDefinition.startsWith("Preposition collocation with") ||
                        cleanDefinition.startsWith("Based on")
                      ) {
                        cleanDefinition = "";
                      }
                      if (cleanDefinition) {
                        const escapedWord = sw.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                        const specificMeaningMatch = cleanDefinition.match(
                          new RegExp(`(?:while|whereas)?\\s*(?:a|an|the)?\\s*['"]?${escapedWord}['"]?\\s*(?:refers to|means|is defined as|denotes|is)\\s*([^.;]+)`, "i")
                        );
                        if (specificMeaningMatch && specificMeaningMatch[1]) {
                          cleanDefinition = specificMeaningMatch[1].trim();
                        }
                      }
                      const displayMeaning = cleanTranslation || cleanDefinition || (sw.hint && !sw.hint.startsWith("Contrast rival") && !sw.hint.startsWith("Based on") && !sw.hint.startsWith("Frequently") ? sw.hint.trim() : "");

                      return (
                        <div
                          key={idx}
                          className="px-3 py-2 sm:py-2.5 bg-stone-50/90 hover:bg-stone-50 border border-stone-200/90 rounded-xl flex items-center justify-between gap-2.5 transition-all shadow-3xs"
                        >
                          <div className="min-w-0 flex-1">
                            {(() => {
                              const isPv = isPhrasalVerb(sw.word, sw.partOfSpeech, sw.category);
                              return (
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-sm font-bold text-stone-950 font-sans tracking-tight">
                                    {sw.word}
                                  </span>
                                  {isPv ? (
                                    <span className="text-[9.5px] font-semibold px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-300/80">
                                      {currentAppLang === "vi" ? "cụm động từ" : "phrasal verb"}
                                    </span>
                                  ) : sw.partOfSpeech ? (
                                    <span className="text-[9.5px] font-medium px-1.5 py-0.2 rounded bg-stone-200/80 text-stone-600 lowercase">
                                      {sw.partOfSpeech}
                                    </span>
                                  ) : null}
                                  {sw.category && sw.category !== "General" && sw.category !== "phrasal verb" && sw.category !== "Phrasal Verbs" && (
                                    <span className="text-[9px] font-medium px-1.5 py-0.2 rounded bg-stone-100 text-stone-600 border border-stone-200">
                                      {sw.category}
                                    </span>
                                  )}
                                </div>
                              );
                            })()}
                            {displayMeaning && (
                              <p className="text-xs text-stone-600 mt-0.5 leading-snug break-words">
                                {displayMeaning}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => speakText(sw.word, ttsConfig, llmConfig, getLanguageCode(targetLanguage))}
                              className="p-1.5 bg-white hover:bg-stone-200 text-stone-700 rounded-lg border border-stone-200/70 shrink-0 cursor-pointer shadow-3xs transition-transform hover:scale-105 active:scale-95"
                              title={`Pronounce "${sw.word}"`}
                            >
                              <Volume2 className="w-3.5 h-3.5" />
                            </button>
                            {!hideAskAiButton && (
                              <button
                                type="button"
                                onClick={() => {
                                  const isPv = isPhrasalVerb(sw.word, sw.partOfSpeech, sw.category);
                                  const matched = words ? findWordInCollection(words, sw.word) : undefined;
                                  setSelectedChatWord(matched || createAdHocWord({
                                    id: `quiz-suggested-${sw.word}-${idx}`,
                                    word: sw.word,
                                    partOfSpeech: isPv ? "phrasal verb" : (sw.partOfSpeech || "vocabulary"),
                                    category: isPv ? "Phrasal Verbs" : sw.category,
                                    definition: displayMeaning || `Recommended vocabulary word for ${targetLanguage}`,
                                    translation: sw.translation || "",
                                    strength: 0,
                                    learned: false,
                                    createdAt: new Date().toISOString(),
                                    lastReviewed: null
                                  }));
                                }}
                                className="p-1.5 bg-white hover:bg-stone-200 text-indigo-700 rounded-lg border border-stone-200/70 shrink-0 cursor-pointer shadow-3xs transition-transform hover:scale-105 active:scale-95"
                                title={`Ask AI about "${sw.word}"`}
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {isAlreadyInWords && (() => {
                              const matched = words ? findWordInCollection(words, sw.word) : undefined;
                              if (matched) {
                                return (
                                  <button
                                    type="button"
                                    onClick={() => setSelectedHistoryWord(matched)}
                                    className="p-1.5 bg-white hover:bg-amber-50 hover:border-amber-300 text-amber-700 rounded-lg border border-stone-200/70 shrink-0 cursor-pointer shadow-3xs transition-transform hover:scale-105 active:scale-95"
                                    title={`View Strength History for "${sw.word}"`}
                                  >
                                    <History className="w-3.5 h-3.5 text-amber-600" />
                                  </button>
                                );
                              }
                              return null;
                            })()}
                            <button
                              type="button"
                              disabled={Boolean(isAlreadyInWords)}
                              onClick={() => {
                                const isPv = isPhrasalVerb(sw.word, sw.partOfSpeech, sw.category);
                                handleAddSuggestedWord(sw.word, displayMeaning || sw.translation || sw.definition, {
                                  word: sw.word,
                                  translation: sw.translation || displayMeaning || "",
                                  definition: sw.definition || displayMeaning || "",
                                  partOfSpeech: isPv ? "phrasal verb" : sw.partOfSpeech,
                                  category: isPv ? "Phrasal Verbs" : sw.category,
                                });
                              }}
                              className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1 transition-all cursor-pointer ${
                                isAlreadyInWords
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200/80 cursor-default"
                                  : "bg-stone-900 hover:bg-stone-800 text-white shadow-3xs active:scale-95"
                              }`}
                            >
                              {isAlreadyInWords ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-600 stroke-[2.5]" />
                                  <span className="text-[11px] font-medium">{t("quiz_suggested_word_added", currentAppLang)}</span>
                                </>
                              ) : (
                                <>
                                  <Plus className="w-3 h-3 stroke-[2.5]" />
                                  <span className="text-[11px] font-medium">{t("quiz_add_suggested_word", currentAppLang)}</span>
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

              {/* AI Response Metadata (Provider, Model, Response Time) */}
              <LlmResponseMetadata
                provider={msg.provider}
                model={msg.model}
                responseTimeMs={msg.responseTimeMs}
              />
              {/* Candidate Words Ready Banner (Shown when starting a new chat) */}
              {isWelcomeMsg && candidateCount > 0 && (
                <div className="mt-4 pt-3.5 border-t border-stone-200/80 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-stone-50/90 -mx-4 -mb-4 p-4 rounded-b-2xl">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 font-bold text-sm shadow-2xs bg-amber-100 text-amber-900 border border-amber-200/60">
                      🧠
                    </div>
                    <div className="min-w-0">
                      <span className="text-[10px] font-bold uppercase tracking-wider block font-mono text-amber-900">
                        {t("chat_quiz_candidates_header", currentAppLang)}
                      </span>
                      <p className="text-xs font-semibold text-stone-800 truncate">
                        {t(
                          candidateCount === 1 ? "chat_word_ready_practice" : "chat_words_ready_practice",
                          currentAppLang,
                          { count: String(candidateCount) }
                        )}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      handleRecordActionUse("start_practice");
                      startPractice();
                    }}
                    className="w-full sm:w-auto px-3.5 py-1.5 bg-stone-900 hover:bg-stone-800 text-amber-400 font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shrink-0 shadow-2xs hover:scale-102 active:scale-98"
                  >
                    <span>
                      {t("chat_practice_now_btn", currentAppLang)}
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
              const isNextQ = act.action === "next_quiz_question" || (act.action === "send_message" && (
                actLbl.startsWith("move on") ||
                actLbl.startsWith("next question") ||
                actLbl.includes("continue to question")
              ));
              const isConfirmSave = act.action === "confirm_save_word" && act.payload && typeof act.payload.word === "string";
              const isSandwichDuel = act.action === "start_sandwich_duel";
              const isSandwichQuiz = act.action === "start_sandwich_quiz";
              const isSandwichAction = isSandwichDuel || isSandwichQuiz;
              const isSandwichDuelLocked = isSandwichDuel && !isAllWarmupReviewed;
              const isDuelPracticeAction = act.action === "start_practice_confuser_duel";
              const isDuelQuizAction = (msg.isConfuserDuel || /Confuser Duel/i.test(msg.content)) && act.action === "quiz_answer";
              const isStoryImmersionAction =
                act.action === "start_practice_story_immersion" ||
                act.action === "start_story_immersion" ||
                act.action === "next_story";
              const currentPayload = customActionPayloads[aIdx] || act.payload;

              return (
                <React.Fragment key={aIdx}>
                  {isConfirmSave && (
                    <WordAddGalleryPreview
                      word={currentPayload}
                      llmConfig={llmConfig}
                      onImagesChange={(updatedUrls) => {
                        setCustomActionPayloads((prev) => ({
                          ...prev,
                          [aIdx]: {
                            ...currentPayload,
                            imageUrls: updatedUrls,
                            imageUrl: updatedUrls?.[0] || undefined,
                          },
                        }));
                      }}
                    />
                  )}

                  <button
                    key={aIdx}
                    onClick={() => handleActionClick(act, aIdx)}
                    title={
                      isSandwichDuelLocked
                        ? t("chat_sandwich_review_all_cards_toast", currentAppLang, {
                            total: String(totalWarmupCards),
                            remaining: String(remainingWarmupToReview),
                          })
                        : undefined
                    }
                    className={`flex items-start justify-between text-left text-xs rounded-xl py-2.5 px-3.5 transition-all duration-200 shadow-2xs group ${
                      isSandwichDuelLocked
                        ? "bg-stone-100/95 hover:bg-stone-200/80 border border-stone-300/80 text-stone-600 cursor-pointer"
                        : isSandwichAction
                        ? "bg-amber-400 hover:bg-amber-300 focus:bg-amber-300 border border-amber-500/80 text-stone-950 font-bold shadow-xs cursor-pointer"
                        : (isDuelPracticeAction || isDuelQuizAction)
                        ? "bg-white hover:bg-stone-900 focus:bg-stone-900 active:bg-stone-900 border border-stone-200 hover:border-stone-900 focus:border-stone-900 text-stone-900 hover:text-white focus:text-white cursor-pointer"
                        : isNextQ
                        ? "bg-stone-900 hover:bg-stone-800 text-white border border-stone-900 font-bold cursor-pointer"
                        : "bg-white hover:bg-stone-900 focus:bg-stone-900 active:bg-stone-900 border border-stone-200 hover:border-stone-900 focus:border-stone-900 text-stone-900 hover:text-white focus:text-white cursor-pointer"
                    }`}
                  >
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    {isSandwichDuelLocked ? (
                      <Lock className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                    ) : isSandwichDuel ? (
                      <Swords className="w-3.5 h-3.5 text-stone-950 shrink-0 mt-0.5" />
                    ) : isSandwichQuiz ? (
                      <Sparkles className="w-3.5 h-3.5 text-stone-950 animate-pulse shrink-0 mt-0.5" />
                    ) : isDuelPracticeAction ? (
                      <Swords className="w-3.5 h-3.5 text-amber-500 group-hover:text-amber-400 group-focus:text-amber-400 shrink-0 mt-0.5" />
                    ) : isDuelQuizAction ? (
                      <Swords className="w-3.5 h-3.5 text-amber-600 group-hover:text-amber-400 shrink-0 mt-0.5" />
                    ) : isStoryImmersionAction ? (
                      <BookOpen className="w-3.5 h-3.5 text-amber-500 group-hover:text-amber-400 group-focus:text-amber-400 shrink-0 mt-0.5" />
                    ) : isNextQ ? (
                      <ChevronRight className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-amber-500 group-hover:text-amber-400 group-focus:text-amber-400 animate-pulse shrink-0 mt-0.5" />
                    )}

                    {isSandwichDuelLocked ? (
                      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-semibold text-stone-700">
                            {formatActionLabel(act, currentAppLang)}
                          </span>
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-100 text-amber-900 border border-amber-200 shrink-0">
                            <Lock className="w-2.5 h-2.5 text-amber-700 shrink-0" />
                            <span>Step 2</span>
                          </span>
                        </div>
                        <span className="text-[11px] font-medium text-amber-800 flex items-center gap-1.5 mt-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0 animate-pulse" />
                          <span>
                            {t("chat_sandwich_review_to_unlock", currentAppLang, {
                              count: String(remainingWarmupToReview),
                            })}
                          </span>
                          <span className="text-stone-500 font-mono text-[10px]">
                            ({reviewedWarmupCount}/{totalWarmupCards})
                          </span>
                        </span>
                      </div>
                    ) : isSandwichDuel ? (
                      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-stone-950">
                            {formatActionLabel(act, currentAppLang)}
                          </span>
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-stone-950 text-amber-300 shrink-0">
                            Ready
                          </span>
                        </div>
                        <span className="text-[11px] font-medium text-stone-900 flex items-center gap-1 mt-0.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-800 shrink-0" />
                          <span>
                            {t("chat_sandwich_cards_reviewed_progress", currentAppLang, {
                              reviewed: String(reviewedWarmupCount),
                              total: String(totalWarmupCards),
                            })}
                          </span>
                        </span>
                      </div>
                    ) : isSandwichQuiz ? (
                      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="font-bold text-stone-950">
                            {formatActionLabel(act, currentAppLang)}
                          </span>
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold rounded bg-stone-950 text-amber-300 shrink-0">
                            Step 3: Quiz
                          </span>
                        </div>
                        <span className="text-[11px] font-medium text-stone-900 flex items-center gap-1 mt-0.5">
                          <Sparkles className="w-3.5 h-3.5 text-stone-950 shrink-0 animate-pulse" />
                          <span>Retention Check & Core Review</span>
                        </span>
                      </div>
                    ) : act.action === "select_definition" && act.payload?.definition ? (
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
                        <div className="mt-1 pt-1 flex items-center justify-between gap-2 border-t border-stone-100/60 group-hover:border-stone-700/60">
                          <span className="text-[10px] text-amber-600 group-hover:text-amber-300 font-medium">
                            Tap card to select sense
                          </span>
                          {!hideAskAiButton && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedChatWord(createAdHocWord({
                                  id: `sense-${act.payload.word}-${Date.now()}`,
                                  word: act.payload.targetWord || act.payload.word,
                                  partOfSpeech: act.payload.partOfSpeech || "expression",
                                  definition: act.payload.definition,
                                  translation: act.payload.translation || "",
                                  example: act.payload.example,
                                  strength: 0,
                                  learned: false,
                                  createdAt: new Date().toISOString(),
                                  lastReviewed: null
                                }));
                              }}
                              className="px-2 py-0.5 rounded bg-stone-100 group-hover:bg-stone-800 text-stone-700 group-hover:text-stone-200 hover:bg-indigo-50 hover:text-indigo-700 border border-stone-200 group-hover:border-stone-700 transition-colors flex items-center gap-1 text-[10px] font-semibold cursor-pointer z-10"
                              title="Ask AI about this specific word sense"
                            >
                              <MessageSquare className="w-3 h-3 text-indigo-500" />
                              <span>Ask AI</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <span className={`whitespace-normal break-words leading-relaxed min-w-0 flex-1 transition-colors ${
                        isNextQ
                          ? "text-white font-bold"
                          : "text-stone-900 group-hover:text-white group-focus:text-white group-active:text-white font-semibold"
                      }`}>
                        {formatActionLabel(act, currentAppLang)}
                      </span>
                    )}
                  </div>
                  {isSandwichDuelLocked ? (
                    <Lock className="w-3.5 h-3.5 text-stone-400 shrink-0 mt-1 ml-2" />
                  ) : (
                    <ChevronRight className={`w-3.5 h-3.5 group-hover:translate-x-0.5 transition-all shrink-0 mt-1 ml-2 ${
                      isSandwichAction
                        ? "text-stone-950"
                        : isNextQ 
                        ? "text-stone-300" 
                        : "text-stone-400 group-hover:text-white group-focus:text-white group-active:text-white"
                    }`} />
                  )}
                </button>
              </React.Fragment>
            );
          })}
          </div>
        )}
      </div>

      {/* Strength History Modal */}
      <AnimatePresence>
        {selectedHistoryWord && (
          <StrengthHistoryModal
            word={selectedHistoryWord}
            onClose={() => setSelectedHistoryWord(null)}
            onUpdateWord={handleModalWordUpdate}
          />
        )}
      </AnimatePresence>

      {/* Word Chat / Ask AI Modal */}
      <AnimatePresence>
        {selectedChatWord && (
          <WordChatModal
            word={selectedChatWord}
            isOpen={Boolean(selectedChatWord)}
            onClose={() => setSelectedChatWord(null)}
            targetLanguage={targetLanguage}
            nativeLanguage={nativeLanguage}
            ttsConfig={ttsConfig}
            llmConfig={llmConfig}
            onAddWord={onAddWord ? (w) => onAddWord(w.word, w.definition || w.translation) : undefined}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default React.memo(ChatMessageItem);
