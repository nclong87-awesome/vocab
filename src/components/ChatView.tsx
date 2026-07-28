import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Send, Sparkles, Trash2, Plus, Volume2, Bot, User, 
  Brain, BookOpen, AlertCircle, HelpCircle, ChevronRight, Check, CheckSquare, RotateCcw
} from "lucide-react";
import { ChatMessage, LLMConfig, TTSConfig, Word } from "../types";
import { speakText, getLanguageCode } from "../utils/ttsService";

interface ChatViewProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => Promise<void>;
  onClearHistory: () => void;
  isTyping: boolean;
  targetLanguage: string;
  nativeLanguage: string;
  onAddWord: (word?: string) => void;
  onGenerateByTopic: () => void;
  onStartQuiz: () => void;
  onSelectDefinition?: (word: string, senseIndex: number, translation: string) => void;
  ttsConfig: TTSConfig;
  llmConfig: LLMConfig;
  words: Word[];
}

// Inline custom markdown-like formatter
function FormattedMessage({ text }: { text: string }) {
  const lines = text.split("\n");
  
  return (
    <div className="space-y-1.5 text-sm sm:text-base leading-relaxed break-words">
      {lines.map((line, i) => {
        // Handle Bullet Points
        if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
          const content = line.trim().substring(2);
          return (
            <ul key={i} className="list-disc pl-5 my-1 text-stone-800">
              <li>{parseInlineMarkdown(content)}</li>
            </ul>
          );
        }
        
        // Handle Numbered List
        const numberedMatch = line.trim().match(/^(\d+)\.\s+(.*)/);
        if (numberedMatch) {
          return (
            <ol key={i} className="list-decimal pl-5 my-1 text-stone-800">
              <li value={parseInt(numberedMatch[1], 10)}>
                {parseInlineMarkdown(numberedMatch[2])}
              </li>
            </ol>
          );
        }

        // Handle Headers
        if (line.trim().startsWith("### ")) {
          return (
            <h4 key={i} className="text-base font-bold text-stone-900 pt-2 pb-1">
              {parseInlineMarkdown(line.trim().substring(4))}
            </h4>
          );
        }
        if (line.trim().startsWith("## ")) {
          return (
            <h3 key={i} className="text-lg font-bold text-stone-900 pt-3 pb-1 border-b border-stone-100">
              {parseInlineMarkdown(line.trim().substring(3))}
            </h3>
          );
        }

        // Default paragraph
        if (line.trim() === "") {
          return <div key={i} className="h-2" />;
        }

        return <p key={i} className="text-stone-800">{parseInlineMarkdown(line)}</p>;
      })}
    </div>
  );
}

// Parse inline formatting (**bold**, `code`, etc.)
function parseInlineMarkdown(text: string) {
  // Simple regex-based inline parser
  const parts = [];
  let index = 0;
  
  // Combine bolding and code highlights
  const tokenRegex = /(\*\*|`)(.*?)\1/g;
  let match;
  
  while ((match = tokenRegex.exec(text)) !== null) {
    // Add text before match
    if (match.index > index) {
      parts.push(text.substring(index, match.index));
    }
    
    const type = match[1];
    const content = match[2];
    
    if (type === "**") {
      parts.push(<strong key={match.index} className="font-bold text-stone-950 bg-stone-100/40 px-0.5 rounded">{content}</strong>);
    } else if (type === "`") {
      parts.push(<code key={match.index} className="px-1 py-0.5 bg-stone-100 rounded text-amber-700 font-mono text-xs sm:text-sm font-semibold">{content}</code>);
    }
    
    index = tokenRegex.lastIndex;
  }
  
  if (index < text.length) {
    parts.push(text.substring(index));
  }
  
  return parts.length > 0 ? parts : text;
}

export default function ChatView({
  messages,
  onSendMessage,
  onClearHistory,
  isTyping,
  targetLanguage,
  nativeLanguage,
  onAddWord,
  onGenerateByTopic,
  onStartQuiz,
  onSelectDefinition,
  ttsConfig,
  llmConfig,
  words
}: ChatViewProps) {
  const [inputText, setInputText] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom when messages change and auto-speak audioWord or quizSpeechText if present on latest assistant message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });

    if (messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      const textToPlay = lastMsg.audioWord || lastMsg.quizSpeechText;
      if (lastMsg.role === "assistant" && textToPlay && (ttsConfig.autoPlayAudioInQuiz ?? true)) {
        const timer = setTimeout(() => {
          speakText(textToPlay, ttsConfig, llmConfig, getLanguageCode(targetLanguage));
        }, 350);
        return () => clearTimeout(timer);
      }
    }
  }, [messages, isTyping, ttsConfig, llmConfig, targetLanguage]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isTyping) return;
    const txt = inputText.trim();
    setInputText("");
    onSendMessage(txt);
  };

  const handleSpeak = (textToSpeak: string) => {
    // Strip out Markdown formatting before speaking
    const cleanedText = textToSpeak
      .replace(/\*\*|`/g, "")
      .replace(/###/g, "")
      .replace(/##/g, "");
    speakText(cleanedText, ttsConfig, llmConfig, getLanguageCode(targetLanguage));
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-92px)] sm:h-[calc(100vh-180px)] bg-white rounded-none sm:rounded-xl border-0 sm:border border-stone-200 overflow-hidden shadow-none sm:shadow-sm" id="chat-container">
      
      {/* Chat Messages Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4" id="chat-messages-body">
        <AnimatePresence initial={false}>
          {messages.map((msg) => {
            const isUser = msg.role === "user";
            
            const parsedQuizOptions: { label: string; action: string; payload: any }[] = [];
            if (!isUser) {
              const lines = msg.content.split("\n");
              for (const line of lines) {
                const cleanLine = line.trim();
                const match = cleanLine.match(/^\s*(?:\*\*)?\s*([A-E])\s*[\)\.]\s*(?:\*\*)?\s*(.+)$/i);
                if (match) {
                  const optionLabel = cleanLine.replace(/\*\*|`/g, "").trim();
                  const optionText = match[2].replace(/\*\*|`/g, "").trim();
                  parsedQuizOptions.push({
                    label: optionLabel,
                    action: "quiz_answer",
                    payload: { answer: optionText }
                  });
                }
              }
            }

            const effectiveActions = parsedQuizOptions.length >= 2 && parsedQuizOptions.length <= 5
              ? parsedQuizOptions
              : (msg.suggestedActions || []);

            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className={`flex flex-col max-w-[92%] sm:max-w-[85%] ${isUser ? "ml-auto" : "mr-auto"}`}
              >
                {/* Message Content Bubble */}
                <div className="space-y-2">
                  <div 
                    className={`p-3.5 rounded-2xl ${
                      isUser 
                        ? "text-stone-900 border border-stone-200/60 rounded-tr-none shadow-3xs" 
                        : "bg-stone-50 border border-stone-100 text-stone-950 rounded-tl-none"
                    }`}
                    style={isUser ? { backgroundColor: "#E5F1FF" } : undefined}
                  >
                    {/* Format standard Markdown */}
                    {isUser ? (
                      <p className="text-sm sm:text-base leading-relaxed font-medium break-words">{msg.content}</p>
                    ) : (
                      <>
                        <FormattedMessage text={msg.content} />

                        {/* Image for visual picture questions */}
                        {msg.imageUrl && (
                          <div className="my-2.5 max-w-sm rounded-xl border border-stone-200 overflow-hidden bg-stone-100 shadow-2xs">
                            <img src={msg.imageUrl} alt="Quiz clue" className="w-full h-auto object-cover max-h-56" referrerPolicy="no-referrer" />
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
                      </>
                    )}

                    {/* Audio reading control for Assistant replies */}
                    {!isUser && (
                      <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-stone-200/50 text-[10px] text-stone-500">
                        <span>AI Tutor</span>
                        <button
                          onClick={() => handleSpeak(msg.audioWord || msg.quizSpeechText || msg.content)}
                          className="flex items-center gap-1 hover:text-stone-900 transition-colors cursor-pointer bg-white border border-stone-200 py-1 px-2 rounded-md hover:bg-stone-50"
                        >
                          <Volume2 className="w-3 h-3 text-stone-600" />
                          {msg.audioWord ? "Listen Audio Clip" : "Listen Pronunciation"}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* AI Suggested Actions Render */}
                  {!isUser && effectiveActions && effectiveActions.length > 0 && (
                    <div className="flex flex-col gap-1.5 pt-1">
                      {effectiveActions.map((act, aIdx) => (
                        <button
                          key={aIdx}
                          onClick={() => {
                            if (act.action === "add_word" && act.payload?.word) {
                              onClearHistory();
                              onAddWord(act.payload.word);
                            } else if (act.action === "start_quiz") {
                              onStartQuiz();
                            } else if (act.action === "quiz_answer" && act.payload?.answer) {
                              onSendMessage(act.payload.answer);
                            } else if (act.action === "select_definition" && act.payload && onSelectDefinition) {
                              onSelectDefinition(act.payload.word, act.payload.senseIndex, act.payload.translation);
                            } else if (act.action === "common_phrases") {
                              onClearHistory();
                              onSendMessage(`What are some common idioms and phrases in ${targetLanguage}?`);
                            } else if (act.action === "send_message" && act.payload?.message) {
                              onSendMessage(act.payload.message);
                            }
                          }}
                          className="flex items-center justify-between text-left text-xs bg-white hover:bg-stone-50 border border-stone-200 rounded-xl py-2 px-3.5 font-bold text-stone-900 transition-all duration-200 hover:scale-[1.01] hover:border-stone-300 shadow-sm cursor-pointer group"
                        >
                          <span className="flex items-center gap-2">
                            <Sparkles className="w-3.5 h-3.5 text-amber-500 animate-pulse" />
                            {act.label}
                          </span>
                          <ChevronRight className="w-3.5 h-3.5 text-stone-400 group-hover:translate-x-0.5 transition-transform" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}

          {/* Typing Indicator */}
          {isTyping && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex max-w-[92%] sm:max-w-[85%] mr-auto"
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

      {/* Quick Action Dock - Centered & Highly Accessible */}
      <div className="bg-stone-50/50 border-t border-stone-200 px-3 py-2 flex items-center gap-2 overflow-x-auto scrollbar-none shrink-0" id="quick-actions-dock">
        <span className="text-[10px] text-stone-400 font-bold uppercase tracking-wider shrink-0 mr-1 select-none">Quick:</span>
        
        <button
          onClick={onClearHistory}
          className="flex items-center gap-1.5 bg-white hover:bg-stone-50 text-stone-700 hover:text-stone-900 border border-stone-200 text-xs font-semibold py-1.5 px-3 rounded-full shadow-2xs transition-all hover:scale-102 cursor-pointer shrink-0"
          title="Start a fresh chat conversation"
          id="start-new-chat-btn"
        >
          <RotateCcw className="w-3.5 h-3.5 text-stone-500" />
          <span>Start new chat</span>
        </button>

        <button
          onClick={onStartQuiz}
          className="flex items-center gap-1.5 bg-stone-900 hover:bg-stone-800 text-white text-xs font-bold py-1.5 px-3 rounded-full shadow-sm transition-all hover:scale-102 cursor-pointer shrink-0"
        >
          <Brain className="w-3.5 h-3.5" />
          Start Today's Quiz
        </button>

        <button
          onClick={onGenerateByTopic}
          className="flex items-center gap-1.5 bg-white hover:bg-stone-50 text-stone-900 border border-stone-200 text-xs font-bold py-1.5 px-3 rounded-full shadow-xs transition-all hover:scale-102 cursor-pointer shrink-0"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          Generate by Topic
        </button>

        <button
          onClick={() => onAddWord()}
          className="flex items-center gap-1.5 bg-white hover:bg-stone-50 text-stone-900 border border-stone-200 text-xs font-bold py-1.5 px-3 rounded-full shadow-xs transition-all hover:scale-102 cursor-pointer shrink-0"
        >
          <Plus className="w-3.5 h-3.5 text-stone-600" />
          Add Word
        </button>

        <button
          onClick={() => {
            onClearHistory();
            onSendMessage(`What are the top 5 most common useful phrases in ${targetLanguage}?`);
          }}
          className="flex items-center gap-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs font-semibold py-1.5 px-3 rounded-full transition-all cursor-pointer shrink-0"
        >
          <HelpCircle className="w-3.5 h-3.5 text-stone-500" />
          Common Phrases
        </button>
      </div>

      {/* Input Message Footer Form */}
      <form onSubmit={handleSubmit} className="p-3 bg-white border-t border-stone-200 shrink-0">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={isTyping}
            placeholder={`Chat with your AI Coach in ${targetLanguage} or ${nativeLanguage}...`}
            className="flex-1 bg-stone-50 hover:bg-stone-100/50 focus:bg-white text-stone-900 border border-stone-200 focus:border-stone-400 focus:ring-0 rounded-xl px-4 py-3 text-sm sm:text-base transition-colors placeholder:text-stone-400 font-medium"
            id="chat-text-input"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || isTyping}
            className={`w-12 h-12 rounded-xl flex items-center justify-center transition-all shadow-sm shrink-0 ${
              inputText.trim() && !isTyping
                ? "bg-stone-900 hover:bg-stone-800 text-white cursor-pointer hover:scale-102"
                : "bg-stone-100 text-stone-400 cursor-not-allowed"
            }`}
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </form>

    </div>
  );
}
