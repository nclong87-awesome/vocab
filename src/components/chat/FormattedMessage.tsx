import React from "react";
import { Sparkles, Volume2 } from "lucide-react";

// Inline custom markdown-like parser for formatting AI messages
export function parseInlineMarkdown(text: string): (string | React.ReactNode)[] | string {
  if (!text) return "";
  const safeText = typeof text === "string" ? text : String(text);
  const parts: (string | React.ReactNode)[] = [];
  let index = 0;
  
  // Combine bolding, code highlights, and italics
  const tokenRegex = /(\*\*|__|`|\*|_)(.*?)\1/g;
  let match: RegExpExecArray | null;
  
  while ((match = tokenRegex.exec(safeText)) !== null) {
    // Add text before match
    if (match.index > index) {
      parts.push(safeText.substring(index, match.index));
    }
    
    const type = match[1];
    const content = match[2];
    
    if (type === "**" || type === "__") {
      parts.push(<strong key={match.index} className="font-bold text-stone-950 bg-stone-100/40 px-0.5 rounded">{content}</strong>);
    } else if (type === "`") {
      parts.push(<code key={match.index} className="px-1 py-0.5 bg-stone-100 rounded text-amber-700 font-mono text-xs sm:text-sm font-semibold">{content}</code>);
    } else if (type === "*" || type === "_") {
      parts.push(<em key={match.index} className="italic text-stone-700 font-medium not-italic-labels">{content}</em>);
    }
    
    index = tokenRegex.lastIndex;
  }
  
  if (index < safeText.length) {
    parts.push(safeText.substring(index));
  }
  
  return parts.length > 0 ? parts : safeText;
}

export function renderCellContent(cellText: string): React.ReactNode {
  if (!cellText) return "";
  const lines = cellText.split(/<br\s*\/?>/i);
  if (lines.length === 1) {
    return parseInlineMarkdown(lines[0]);
  }
  return lines.map((sub, sIdx) => (
    <React.Fragment key={sIdx}>
      {sIdx > 0 && <br />}
      {parseInlineMarkdown(sub)}
    </React.Fragment>
  ));
}

export function isTableDelimiter(line: string): boolean {
  if (!line) return false;
  const trimmed = line.trim();
  if (!trimmed.includes("-") || !trimmed.includes("|")) return false;
  const cleaned = trimmed.replace(/^\|/, "").replace(/\|$/, "").trim();
  if (!cleaned) return false;
  const segments = cleaned.split("|");
  if (segments.length === 0) return false;
  return segments.every(seg => /^\s*:?-{1,}:?\s*$/.test(seg));
}

export function isPotentialTableRow(line: string): boolean {
  if (!line) return false;
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return false;
  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith(">") ||
    trimmed.startsWith("```") ||
    trimmed.startsWith("- ") ||
    trimmed.startsWith("* ")
  ) {
    return false;
  }
  return true;
}

export function parseRowCells(rowStr: string): string[] {
  let trimmed = rowStr.trim();
  if (trimmed.startsWith("|")) {
    trimmed = trimmed.substring(1);
  }
  if (trimmed.endsWith("|")) {
    trimmed = trimmed.substring(0, trimmed.length - 1);
  }
  const rawCells: string[] = [];
  let current = "";
  let inCode = false;
  let isEscaped = false;

  for (let c = 0; c < trimmed.length; c++) {
    const char = trimmed[c];
    if (char === "`" && !isEscaped) {
      inCode = !inCode;
      current += char;
      continue;
    }
    if (char === "\\" && !isEscaped) {
      isEscaped = true;
      continue;
    }
    if (char === "|" && !isEscaped && !inCode) {
      rawCells.push(current.trim());
      current = "";
    } else {
      if (isEscaped) {
        current += "\\" + char;
        isEscaped = false;
      } else {
        current += char;
      }
    }
  }
  rawCells.push(current.trim());
  return rawCells;
}

export function getColumnAlignments(delimiterStr: string): ("left" | "center" | "right")[] {
  const cells = parseRowCells(delimiterStr);
  return cells.map(cell => {
    const trimmed = cell.trim();
    const starts = trimmed.startsWith(":");
    const ends = trimmed.endsWith(":");
    if (starts && ends) return "center";
    if (ends) return "right";
    return "left";
  });
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

    const blocks: React.ReactNode[] = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // Check if line specifies a new word context
      const wMatch = line.match(/^\s*\*(?:Word|Từ|Wort|Mot|Palabra|Parola|Palavra|단어|単語|词|单词)\*:\s*(?:\*\*)?([^*(\n\r]+)/i);
      if (wMatch) {
        currentSectionWord = wMatch[1].replace(/\*\*/g, "").trim();
      }

      const hMatch = line.match(/^\s*###\s*(?:\d+\.\s*)?\*\*([^*]+)\*\*/i);
      if (hMatch) {
        currentSectionWord = hMatch[1].trim();
      }

      // 1. Handle Markdown Table Detection
      if (
        isPotentialTableRow(line) &&
        !isTableDelimiter(line) &&
        i + 1 < lines.length &&
        isTableDelimiter(lines[i + 1])
      ) {
        const headerCells = parseRowCells(line);
        const delimiterLine = lines[i + 1];
        const alignments = getColumnAlignments(delimiterLine);
        const dataRows: string[][] = [];
        const tableStartIndex = i;

        i += 2; // Move past header and delimiter lines

        while (i < lines.length) {
          const candidateRow = lines[i];
          if (
            !candidateRow ||
            candidateRow.trim() === "" ||
            !isPotentialTableRow(candidateRow) ||
            isTableDelimiter(candidateRow)
          ) {
            break;
          }
          dataRows.push(parseRowCells(candidateRow));
          i++;
        }

        const totalCols = Math.max(
          headerCells.length,
          ...dataRows.map(r => r.length),
          1
        );

        // Normalize header columns
        const normalizedHeaders = [...headerCells];
        while (normalizedHeaders.length < totalCols) {
          normalizedHeaders.push("");
        }

        // Normalize row columns
        const normalizedRows = dataRows.map(r => {
          const rowCopy = [...r];
          while (rowCopy.length < totalCols) {
            rowCopy.push("");
          }
          return rowCopy;
        });

        blocks.push(
          <div
            key={`table-${tableStartIndex}`}
            className="w-full my-3 overflow-hidden rounded-xl border border-stone-200/90 bg-white shadow-2xs"
          >
            <div className="overflow-x-auto overscroll-x-contain scrollbar-thin">
              <table
                className={`w-full text-left border-collapse text-xs sm:text-sm ${
                  totalCols >= 4
                    ? "min-w-[620px]"
                    : totalCols === 3
                    ? "min-w-[480px]"
                    : "min-w-full"
                }`}
              >
                <thead className="bg-stone-100/90 text-stone-900 border-b border-stone-200">
                  <tr>
                    {normalizedHeaders.map((cell, cIdx) => {
                      const align = alignments[cIdx] || "left";
                      const alignClass =
                        align === "center"
                          ? "text-center"
                          : align === "right"
                          ? "text-right"
                          : "text-left";
                      return (
                        <th
                          key={cIdx}
                          className={`py-2.5 px-3.5 font-bold tracking-tight text-stone-900 ${alignClass} ${
                            cIdx === 0 && totalCols > 2 ? "sm:w-1/4" : ""
                          }`}
                        >
                          {renderCellContent(cell)}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-150">
                  {normalizedRows.map((row, rIdx) => (
                    <tr
                      key={rIdx}
                      className={`transition-colors ${
                        rIdx % 2 === 0 ? "bg-white" : "bg-stone-50/50"
                      } hover:bg-amber-50/30`}
                    >
                      {row.map((cell, cIdx) => {
                        const align = alignments[cIdx] || "left";
                        const alignClass =
                          align === "center"
                            ? "text-center"
                            : align === "right"
                            ? "text-right"
                            : "text-left";
                        const isFirstCol = cIdx === 0 && totalCols > 1;
                        return (
                          <td
                            key={cIdx}
                            className={`py-2.5 px-3.5 align-top leading-relaxed text-stone-800 ${alignClass} ${
                              isFirstCol ? "font-semibold text-stone-950" : ""
                            }`}
                          >
                            {renderCellContent(cell)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {totalCols >= 3 && (
              <div className="sm:hidden px-3 py-1 bg-stone-50/90 border-t border-stone-200/60 flex items-center justify-between text-[10px] text-stone-500 select-none">
                <span className="flex items-center gap-1 font-medium text-stone-600">
                  <span>← Swipe horizontally to see all columns →</span>
                </span>
                <span className="font-mono text-[9px] text-stone-400">{totalCols} cols</span>
              </div>
            )}
          </div>
        );
        continue;
      }

      // Handle Bullet Points
      if (line.trim().startsWith("- ") || line.trim().startsWith("* ")) {
        const content = line.trim().substring(2);
        const matchingAction = findMatchingAction(content, suggestedActions);

        blocks.push(
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
        i++;
        continue;
      }
      
      // Handle Numbered List
      const numberedMatch = line.trim().match(/^(\d+)\.\s+(.*)/);
      if (numberedMatch) {
        const content = numberedMatch[2];
        const matchingAction = findMatchingAction(content, suggestedActions);

        blocks.push(
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
        i++;
        continue;
      }

      // Handle Blockquotes
      if (line.trim().startsWith("> ")) {
        const content = line.trim().substring(2);
        blocks.push(
          <blockquote key={i} className="border-l-4 border-amber-400 bg-amber-50/70 pl-3 py-2 pr-2 my-2 text-stone-900 font-semibold rounded-r-lg shadow-2xs">
            {parseInlineMarkdown(content)}
          </blockquote>
        );
        i++;
        continue;
      }

      // Handle Horizontal Rule / Divider (---, ***, ___)
      if (/^(?:---|—{3,}|\*\*\*|___)\s*$/.test(line.trim())) {
        blocks.push(<hr key={i} className="border-t border-stone-200/80 my-1 border-solid" />);
        i++;
        continue;
      }

      // Handle Headers
      if (line.trim().startsWith("### ")) {
        const headerContent = line.trim().substring(4);
        const hasIpaOrPronunciation = /`\/[^\/]+\/`/.test(headerContent) || /\/[a-zA-Zˈˌːɪɛæɑɔʊəʌpbtdkɡfvθðszʃʒhmnŋlrjw]+?\//.test(headerContent);
        const headerWord = hMatch ? hMatch[1].trim() : (currentSectionWord || globalDetectedWord);

        // If preceded by a divider or at the start, keep top spacing minimal to avoid excessive gaps
        let isPrecededByDivider = false;
        for (let pIdx = i - 1; pIdx >= 0; pIdx--) {
          const prev = lines[pIdx].trim();
          if (prev === "") continue;
          if (/^(?:---|—{3,}|\*\*\*|___)\s*$/.test(prev)) {
            isPrecededByDivider = true;
          }
          break;
        }

        blocks.push(
          <div key={i} className={`flex items-center gap-2 ${isPrecededByDivider ? "pt-0.5" : "pt-1.5"} pb-0.5 flex-wrap`}>
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
        i++;
        continue;
      }
      if (line.trim().startsWith("## ")) {
        blocks.push(
          <h3 key={i} className="text-lg font-bold text-stone-900 pt-2 pb-1 border-b border-stone-100">
            {parseInlineMarkdown(line.trim().substring(3))}
          </h3>
        );
        i++;
        continue;
      }

      // Handle Sentence line with audio button
      const sentenceLineMatch = line.match(/^\s*\*(?:Sentence|Câu hoàn chỉnh|Câu mẫu|例文|Frase|Vollständiger Satz|完整例句|완성된 문장|Phrase complète)\*:\s*(?:\*\*)?["“]?([^"”\n\r]+)["”]?/i);
      if (sentenceLineMatch && onPlayAudio) {
        const rawSentence = sentenceLineMatch[1].replace(/\*\*/g, "").trim();
        blocks.push(
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
        i++;
        continue;
      }

      // Default paragraph or empty line
      if (line.trim() === "") {
        // Skip redundant empty lines: at edges, adjacent to dividers, preceding headers, or stacked
        if (i === 0 || i === lines.length - 1) {
          i++;
          continue;
        }
        if (lines[i - 1]?.trim() === "") {
          i++;
          continue;
        }
        if (/^(?:---|—{3,}|\*\*\*|___)\s*$/.test(lines[i - 1]?.trim() || "")) {
          i++;
          continue;
        }
        if (/^(?:---|—{3,}|\*\*\*|___)\s*$/.test(lines[i + 1]?.trim() || "")) {
          i++;
          continue;
        }
        if (lines[i + 1]?.trim().startsWith("### ") || lines[i + 1]?.trim().startsWith("## ")) {
          i++;
          continue;
        }
        blocks.push(<div key={i} className="h-1" />);
        i++;
        continue;
      }

      blocks.push(<p key={i} className="text-stone-800">{parseInlineMarkdown(line)}</p>);
      i++;
    }

    return blocks;
  }, [safeText, suggestedActions, onActionClick, appLanguage, onPlayAudio, targetWord]);

  return (
    <div className="space-y-1.5 text-sm sm:text-base leading-relaxed break-words">
      {renderedContent}
    </div>
  );
}

export default React.memo(FormattedMessage);
