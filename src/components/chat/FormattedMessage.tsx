import React from "react";
import { Sparkles, Volume2 } from "lucide-react";

// Inline custom markdown-like parser for formatting AI messages
export function parseInlineMarkdown(text: string): (string | React.ReactNode)[] | string {
  if (!text) return "";
  const safeText = typeof text === "string" ? text : String(text);
  const parts: (string | React.ReactNode)[] = [];
  let index = 0;
  
  // Combine bolding, code highlights, and italics
  const tokenRegex = /(\*\*|`|\*)(.*?)\1/g;
  let match: RegExpExecArray | null;
  
  while ((match = tokenRegex.exec(safeText)) !== null) {
    // Add text before match
    if (match.index > index) {
      parts.push(safeText.substring(index, match.index));
    }
    
    const type = match[1];
    const content = match[2];
    
    if (type === "**") {
      parts.push(<strong key={match.index} className="font-bold text-stone-950 bg-stone-100/40 px-0.5 rounded">{content}</strong>);
    } else if (type === "`") {
      parts.push(<code key={match.index} className="px-1 py-0.5 bg-stone-100 rounded text-amber-700 font-mono text-xs sm:text-sm font-semibold">{content}</code>);
    } else if (type === "*") {
      parts.push(<em key={match.index} className="italic text-stone-700 font-medium not-italic-labels">{content}</em>);
    }
    
    index = tokenRegex.lastIndex;
  }
  
  if (index < safeText.length) {
    parts.push(safeText.substring(index));
  }
  
  return parts.length > 0 ? parts : safeText;
}

export function cleanStringForMatching(s: string): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/[\*\_\(\)\-\•\d\.\:\;\,\>\!\?\🏆\🎨\🍽️\✈️\💼\🗣️\⏳\🔗\🔄\☕\🤝\👋\🎯\🧠\🃏\✏️\➕\✕]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function findMatchingAction(
  lineText: string,
  actions?: { label: string; action: string; payload?: any }[]
): { label: string; action: string; payload?: any } | null {
  if (!actions || actions.length === 0) return null;

  const cleanedLine = cleanStringForMatching(lineText);
  if (!cleanedLine || cleanedLine.length < 2) return null;

  for (const act of actions) {
    if (!act || !act.label) continue;
    const cleanedLabel = cleanStringForMatching(act.label);
    if (!cleanedLabel || cleanedLabel.length < 2) continue;

    if (cleanedLine.includes(cleanedLabel) || cleanedLabel.includes(cleanedLine)) {
      return act;
    }
  }

  for (const act of actions) {
    if (act.action === "send_message" && act.payload?.message) {
      const cleanedMsg = cleanStringForMatching(act.payload.message);
      if (!cleanedMsg || cleanedMsg.length < 2) continue;

      if (cleanedLine.includes(cleanedMsg) || cleanedMsg.includes(cleanedLine)) {
        return act;
      }
    }
  }

  return null;
}

function getPracticeLabel(appLang: string): string {
  const code = appLang.toLowerCase().trim();
  if (code.startsWith("vi")) return "Thực hành";
  if (code.startsWith("es")) return "Practicar";
  if (code.startsWith("fr")) return "S'exercer";
  if (code.startsWith("de")) return "Üben";
  if (code.startsWith("ja")) return "練習する";
  if (code.startsWith("ko")) return "연습하기";
  if (code.startsWith("zh")) return "练习";
  return "Practice";
}

interface FormattedMessageProps {
  text: string;
  suggestedActions?: { label: string; action: string; payload?: any }[];
  onActionClick?: (action: { label: string; action: string; payload?: any }) => void;
  appLanguage?: string;
  onPlayAudio?: (text: string) => void;
  targetWord?: string;
}

function FormattedMessage({
  text,
  suggestedActions,
  onActionClick,
  appLanguage,
  onPlayAudio,
  targetWord,
}: FormattedMessageProps) {
  const safeText = typeof text === "string" ? text : (text ? String(text) : "");

  const renderedContent = React.useMemo(() => {
    const lines = safeText.split("\n");

    // Scan for potential target words in this message block
    let globalDetectedWord = targetWord || "";
    if (!globalDetectedWord) {
      // 1. Look for explicit *Word*: ... or *Từ*: ... lines
      for (const l of lines) {
        const wMatch = l.match(/^\s*\*(?:Word|Từ|Wort|Mot|Palabra|Parola|Palavra|단어|単語|词|单词)\*:\s*(?:\*\*)?([^*(\n\r]+)/i);
        if (wMatch) {
          globalDetectedWord = wMatch[1].replace(/\*\*/g, "").trim();
          break;
        }
      }
    }
    if (!globalDetectedWord) {
      // 2. Look for answer pattern: e.g. is "experiment" or is **"experiment"** or Correct answer: "experiment"
      const ansMatch = safeText.match(/(?:is\s+|answer:\s*|đúng:\s*)(?:\*\*)?["“]([^"”]+)["”]/i);
      if (ansMatch) {
        globalDetectedWord = ansMatch[1].trim();
      }
    }
    if (!globalDetectedWord) {
      // 3. Look for header pattern: ### **word** `/ipa/`
      for (const l of lines) {
        const hMatch = l.match(/^\s*###\s*(?:\d+\.\s*)?\*\*([^*]+)\*\*/i);
        if (hMatch) {
          globalDetectedWord = hMatch[1].trim();
          break;
        }
      }
    }

    let currentSectionWord = globalDetectedWord;

    return lines.map((line, i) => {
      // Check if line specifies a new word context
      const wMatch = line.match(/^\s*\*(?:Word|Từ|Wort|Mot|Palabra|Parola|Palavra|단어|単語|词|单词)\*:\s*(?:\*\*)?([^*(\n\r]+)/i);
      if (wMatch) {
        currentSectionWord = wMatch[1].replace(/\*\*/g, "").trim();
      }

      const hMatch = line.match(/^\s*###\s*(?:\d+\.\s*)?\*\*([^*]+)\*\*/i);
      if (hMatch) {
        currentSectionWord = hMatch[1].trim();
      }



      // Handle Bullet Points
      if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
        const content = line.trim().substring(2);
        const matchingAction = findMatchingAction(content, suggestedActions);

        return (
          <ul key={i} className="list-disc pl-5 my-1 text-stone-800">
            <li className="relative group/bullet">
              <span className="align-middle">{parseInlineMarkdown(content)}</span>
              {matchingAction && onActionClick && (
                <button
                  type="button"
                  onClick={() => onActionClick(matchingAction)}
                  className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 bg-amber-400 hover:bg-amber-500 active:scale-95 text-stone-950 font-bold text-[11px] rounded transition-all border border-amber-500/10 shadow-3xs cursor-pointer align-middle select-none hover:scale-105"
                  title={`Start topic: ${matchingAction.label}`}
                >
                  <Sparkles className="w-3 h-3 text-stone-950 animate-pulse" />
                  <span>{getPracticeLabel(appLanguage || "en")}</span>
                </button>
              )}
            </li>
          </ul>
        );
      }
      
      // Handle Numbered List
      const numberedMatch = line.trim().match(/^(\d+)\.\s+(.*)/);
      if (numberedMatch) {
        const content = numberedMatch[2];
        const matchingAction = findMatchingAction(content, suggestedActions);

        return (
          <ol key={i} className="list-decimal pl-5 my-1 text-stone-800">
            <li value={parseInt(numberedMatch[1], 10)} className="relative group/bullet">
              <span className="align-middle">{parseInlineMarkdown(content)}</span>
              {matchingAction && onActionClick && (
                <button
                  type="button"
                  onClick={() => onActionClick(matchingAction)}
                  className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 bg-amber-400 hover:bg-amber-500 active:scale-95 text-stone-950 font-bold text-[11px] rounded transition-all border border-amber-500/10 shadow-3xs cursor-pointer align-middle select-none hover:scale-105"
                  title={`Start topic: ${matchingAction.label}`}
                >
                  <Sparkles className="w-3 h-3 text-stone-950 animate-pulse" />
                  <span>{getPracticeLabel(appLanguage || "en")}</span>
                </button>
              )}
            </li>
          </ol>
        );
      }

      // Handle Blockquotes
      if (line.trim().startsWith("> ")) {
        const content = line.trim().substring(2);
        return (
          <blockquote key={i} className="border-l-4 border-amber-400 bg-amber-50/70 pl-3 py-2 pr-2 my-2 text-stone-900 font-semibold rounded-r-lg shadow-2xs">
            {parseInlineMarkdown(content)}
          </blockquote>
        );
      }

      // Handle Headers
      if (line.trim().startsWith("### ")) {
        const headerContent = line.trim().substring(4);
        const hasIpaOrPronunciation = /`\/[^\/]+\/`/.test(headerContent) || /\/[a-zA-Zˈˌːɪɛæɑɔʊəʌpbtdkɡfvθðszʃʒhmnŋlrjw]+?\//.test(headerContent);
        const headerWord = hMatch ? hMatch[1].trim() : (currentSectionWord || globalDetectedWord);

        return (
          <div key={i} className="flex items-center gap-2 pt-2 pb-1 flex-wrap">
            <h4 className="text-base font-bold text-stone-900">
              {parseInlineMarkdown(headerContent)}
            </h4>
            {hasIpaOrPronunciation && onPlayAudio && headerWord && (
              <button
                type="button"
                onClick={() => onPlayAudio(headerWord)}
                className="p-1 rounded-md bg-stone-100 hover:bg-amber-100 hover:border-amber-400 text-stone-700 hover:text-amber-950 border border-stone-200/80 transition-all cursor-pointer shadow-3xs inline-flex items-center justify-center shrink-0 active:scale-95"
                title={`Play audio for "${headerWord}"`}
                aria-label={`Play audio for "${headerWord}"`}
              >
                <Volume2 className="w-3.5 h-3.5 text-amber-700" />
              </button>
            )}
          </div>
        );
      }
      if (line.trim().startsWith("## ")) {
        return (
          <h3 key={i} className="text-lg font-bold text-stone-900 pt-3 pb-1 border-b border-stone-100">
            {parseInlineMarkdown(line.trim().substring(3))}
          </h3>
        );
      }

      // Handle Sentence line with audio button
      const sentenceLineMatch = line.match(/^\s*\*(?:Sentence|Câu hoàn chỉnh|Câu mẫu|例文|Frase|Vollständiger Satz|完整例句|완성된 문장|Phrase complète)\*:\s*(?:\*\*)?["“]?([^"”\n\r]+)["”]?/i);
      if (sentenceLineMatch && onPlayAudio) {
        const rawSentence = sentenceLineMatch[1].replace(/\*\*/g, "").trim();
        return (
          <div key={i} className="flex items-center gap-1.5 flex-wrap my-0.5">
            <p className="text-stone-800 m-0">{parseInlineMarkdown(line)}</p>
            {rawSentence && (
              <button
                type="button"
                onClick={() => onPlayAudio(rawSentence)}
                className="p-1 rounded-md bg-stone-100 hover:bg-amber-100 hover:border-amber-400 text-stone-700 hover:text-amber-950 border border-stone-200/80 transition-all cursor-pointer shadow-3xs inline-flex items-center justify-center shrink-0 active:scale-95 ml-0.5"
                title="Listen to sentence"
                aria-label="Listen to sentence"
              >
                <Volume2 className="w-3.5 h-3.5 text-amber-700" />
              </button>
            )}
          </div>
        );
      }

      // Default paragraph
      if (line.trim() === "") {
        return <div key={i} className="h-2" />;
      }

      return <p key={i} className="text-stone-800">{parseInlineMarkdown(line)}</p>;
    });
  }, [safeText, suggestedActions, onActionClick, appLanguage, onPlayAudio, targetWord]);

  return (
    <div className="space-y-1.5 text-sm sm:text-base leading-relaxed break-words">
      {renderedContent}
    </div>
  );
}

export default React.memo(FormattedMessage);
