import React from "react";

// Inline custom markdown-like parser for formatting AI messages
export function parseInlineMarkdown(text: string): (string | React.ReactNode)[] | string {
  const parts: (string | React.ReactNode)[] = [];
  let index = 0;
  
  // Combine bolding and code highlights
  const tokenRegex = /(\*\*|`)(.*?)\1/g;
  let match: RegExpExecArray | null;
  
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

interface FormattedMessageProps {
  text: string;
}

export default function FormattedMessage({ text }: FormattedMessageProps) {
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
