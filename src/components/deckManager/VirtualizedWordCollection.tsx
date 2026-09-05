import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { List, useDynamicRowHeight } from "react-window";
import { Maximize2, Minimize2, Zap } from "lucide-react";
import { Word, LLMConfig, TTSConfig } from "../../types";
import WordCard from "./WordCard";
import WordRow from "./WordRow";

interface VirtualizedWordCollectionProps {
  words: Word[];
  viewMode: "grid" | "list";
  speakWord: (text: string) => void;
  handleRegenerateWord: (word: Word) => void;
  regeneratingWordId: string | null;
  regeneratedSuccessWordId: string | null;
  onToggleStar: (wordId: string) => void;
  onToggleLearned: (wordId: string) => void;
  onDeleteWord: (wordId: string) => void;
  brokenImageIds: Set<string>;
  handleImageError: (wordId: string) => void;
  onUpdateWord?: (updatedWord: Word) => void;
  llmConfig?: LLMConfig;
  targetLanguage?: string;
  nativeLanguage?: string;
  ttsConfig?: TTSConfig;
  allWords?: Word[];
  onAddWord?: (word: string, hint?: string) => void;
  containerHeight?: number;
}

interface ListRowSharedProps {
  words: Word[];
  speakWord: (text: string) => void;
  handleRegenerateWord: (word: Word) => void;
  regeneratingWordId: string | null;
  onToggleStar: (wordId: string) => void;
  onToggleLearned: (wordId: string) => void;
  onDeleteWord: (wordId: string) => void;
  brokenImageIds: Set<string>;
  handleImageError: (wordId: string) => void;
  onUpdateWord?: (updatedWord: Word) => void;
  llmConfig?: LLMConfig;
  targetLanguage?: string;
  nativeLanguage?: string;
  ttsConfig?: TTSConfig;
  allWords?: Word[];
  onAddWord?: (word: string, hint?: string) => void;
}

interface GridRowSharedProps extends ListRowSharedProps {
  columnCount: number;
  regeneratedSuccessWordId: string | null;
}

function VirtualListRow(props: {
  ariaAttributes: {
    "aria-posinset": number;
    "aria-setsize": number;
    role: "listitem";
  };
  index: number;
  style: React.CSSProperties;
} & ListRowSharedProps): React.ReactElement | null {
  const { index, style, words, ...rest } = props;
  const word = words[index];
  if (!word) return null;

  return (
    <div style={style} className="pb-3 px-0.5">
      <WordRow
        word={word}
        speakWord={rest.speakWord}
        handleRegenerateWord={rest.handleRegenerateWord}
        regeneratingWordId={rest.regeneratingWordId}
        onToggleStar={rest.onToggleStar}
        onToggleLearned={rest.onToggleLearned}
        onDeleteWord={rest.onDeleteWord}
        brokenImageIds={rest.brokenImageIds}
        handleImageError={rest.handleImageError}
        onUpdateWord={rest.onUpdateWord}
        llmConfig={rest.llmConfig}
        targetLanguage={rest.targetLanguage}
        nativeLanguage={rest.nativeLanguage}
        ttsConfig={rest.ttsConfig}
        words={rest.allWords}
        onAddWord={rest.onAddWord}
      />
    </div>
  );
}

function VirtualGridRow(props: {
  ariaAttributes: {
    "aria-posinset": number;
    "aria-setsize": number;
    role: "listitem";
  };
  index: number;
  style: React.CSSProperties;
} & GridRowSharedProps): React.ReactElement | null {
  const { index, style, words, columnCount, regeneratedSuccessWordId, ...rest } = props;
  const startIndex = index * columnCount;
  const wordA = words[startIndex];
  const wordB = columnCount > 1 ? words[startIndex + 1] : undefined;

  if (!wordA && !wordB) return null;

  return (
    <div style={style} className="pb-4 px-0.5">
      <div className={`grid gap-4 ${columnCount > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
        {wordA && (
          <WordCard
            word={wordA}
            speakWord={rest.speakWord}
            handleRegenerateWord={rest.handleRegenerateWord}
            regeneratingWordId={rest.regeneratingWordId}
            regeneratedSuccessWordId={regeneratedSuccessWordId}
            onToggleStar={rest.onToggleStar}
            onToggleLearned={rest.onToggleLearned}
            onDeleteWord={rest.onDeleteWord}
            brokenImageIds={rest.brokenImageIds}
            handleImageError={rest.handleImageError}
            onUpdateWord={rest.onUpdateWord}
            llmConfig={rest.llmConfig}
            targetLanguage={rest.targetLanguage}
            nativeLanguage={rest.nativeLanguage}
            ttsConfig={rest.ttsConfig}
            words={rest.allWords}
            onAddWord={rest.onAddWord}
          />
        )}
        {wordB && (
          <WordCard
            word={wordB}
            speakWord={rest.speakWord}
            handleRegenerateWord={rest.handleRegenerateWord}
            regeneratingWordId={rest.regeneratingWordId}
            regeneratedSuccessWordId={regeneratedSuccessWordId}
            onToggleStar={rest.onToggleStar}
            onToggleLearned={rest.onToggleLearned}
            onDeleteWord={rest.onDeleteWord}
            brokenImageIds={rest.brokenImageIds}
            handleImageError={rest.handleImageError}
            onUpdateWord={rest.onUpdateWord}
            llmConfig={rest.llmConfig}
            targetLanguage={rest.targetLanguage}
            nativeLanguage={rest.nativeLanguage}
            ttsConfig={rest.ttsConfig}
            words={rest.allWords}
            onAddWord={rest.onAddWord}
          />
        )}
      </div>
    </div>
  );
}

export default function VirtualizedWordCollection({
  words,
  viewMode,
  speakWord,
  handleRegenerateWord,
  regeneratingWordId,
  regeneratedSuccessWordId,
  onToggleStar,
  onToggleLearned,
  onDeleteWord,
  brokenImageIds,
  handleImageError,
  onUpdateWord,
  llmConfig,
  targetLanguage,
  nativeLanguage,
  ttsConfig,
  allWords,
  onAddWord,
  containerHeight: customHeight,
}: VirtualizedWordCollectionProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(800);
  const [windowHeight, setWindowHeight] = useState<number>(() => 
    typeof window !== "undefined" ? window.innerHeight : 800
  );
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  const listRef = useRef<{
    get element(): HTMLDivElement | null;
    scrollToRow(config: {
      align?: "auto" | "center" | "end" | "smart" | "start";
      behavior?: "auto" | "instant" | "smooth";
      index: number;
    }): void;
  } | null>(null);

  // Scroll to top of virtual list when words array changes (e.g. search, sort, page change)
  useEffect(() => {
    listRef.current?.scrollToRow({ index: 0, behavior: "auto" });
  }, [words]);

  // Measure container width for responsive column counts (1 col on mobile, 2 cols on md+)
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setContainerWidth(entry.contentRect.width);
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const handleResize = () => setWindowHeight(window.innerHeight);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const columnCount = useMemo(() => {
    if (viewMode === "list") return 1;
    // For grid view: 1 column if container is narrower than 680px, 2 columns otherwise
    return containerWidth >= 680 ? 2 : 1;
  }, [viewMode, containerWidth]);

  const rowCount = useMemo(() => {
    if (viewMode === "list") return words.length;
    return Math.ceil(words.length / columnCount);
  }, [words.length, viewMode, columnCount]);

  // Dynamic row height handlers with cache key that resets on mode/column changes
  const dynamicKey = useMemo(() => {
    return `${viewMode}-${columnCount}-${words.length}`;
  }, [viewMode, columnCount, words.length]);

  const defaultRowHeight = viewMode === "list" ? 92 : 280;

  const dynamicRowHeight = useDynamicRowHeight({
    defaultRowHeight,
    key: dynamicKey,
  });

  // Calculate suitable height for the virtualized container
  const resolvedHeight = useMemo(() => {
    if (customHeight) return customHeight;
    // Calculate total height of items if list is short
    const estimatedTotal = rowCount * defaultRowHeight + 24;
    const maxAvailable = isExpanded
      ? Math.max(650, windowHeight - 180)
      : Math.max(450, Math.min(850, windowHeight - 340));
    return Math.min(estimatedTotal, maxAvailable);
  }, [customHeight, rowCount, defaultRowHeight, windowHeight, isExpanded]);

  const listRowProps: ListRowSharedProps = useMemo(() => ({
    words,
    speakWord,
    handleRegenerateWord,
    regeneratingWordId,
    onToggleStar,
    onToggleLearned,
    onDeleteWord,
    brokenImageIds,
    handleImageError,
    onUpdateWord,
    llmConfig,
    targetLanguage,
    nativeLanguage,
    ttsConfig,
    allWords,
    onAddWord,
  }), [
    words,
    speakWord,
    handleRegenerateWord,
    regeneratingWordId,
    onToggleStar,
    onToggleLearned,
    onDeleteWord,
    brokenImageIds,
    handleImageError,
    onUpdateWord,
    llmConfig,
    targetLanguage,
    nativeLanguage,
    ttsConfig,
    allWords,
    onAddWord,
  ]);

  const gridRowProps: GridRowSharedProps = useMemo(() => ({
    ...listRowProps,
    columnCount,
    regeneratedSuccessWordId,
  }), [listRowProps, columnCount, regeneratedSuccessWordId]);

  const listRowKey = useCallback(
    (index: number, data: ListRowSharedProps) => {
      return data.words[index]?.id || `word-row-${index}`;
    },
    []
  );

  const gridRowKey = useCallback(
    (index: number, data: GridRowSharedProps) => {
      const start = index * data.columnCount;
      const idA = data.words[start]?.id || `empty-a-${start}`;
      const idB = data.words[start + 1]?.id || `empty-b-${start}`;
      return `grid-row-${idA}-${idB}`;
    },
    []
  );

  if (words.length === 0) {
    return null;
  }

  return (
    <div 
      ref={containerRef} 
      className="w-full relative border border-stone-200/80 bg-stone-50/40 rounded-xl p-2 sm:p-3 overflow-hidden shadow-3xs"
      id="virtualized-word-collection-wrapper"
    >
      <div className="flex items-center justify-between px-1.5 pb-2 mb-2 border-b border-stone-200/70 text-[11px] text-stone-500 font-mono select-none">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 font-semibold text-stone-800 bg-amber-100/70 text-amber-950 border border-amber-300/80 px-2 py-0.5 rounded text-[10px] tracking-wide uppercase">
            <Zap className="w-3 h-3 text-amber-600 fill-amber-500" />
            <span>Virtual List</span>
          </span>
          <span className="text-stone-500 hidden sm:inline text-xs font-sans">
            {words.length} terms &bull; {rowCount} rows
          </span>
        </div>
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => listRef.current?.scrollToRow({ index: 0, behavior: "smooth" })}
            className="text-stone-600 hover:text-stone-900 transition-colors font-sans text-xs px-2 py-0.5 rounded hover:bg-stone-200/60 cursor-pointer"
            title="Scroll virtual list to top"
          >
            Top ↑
          </button>
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="text-stone-600 hover:text-stone-900 transition-colors inline-flex items-center gap-1 font-sans text-xs px-2 py-0.5 rounded hover:bg-stone-200/60 cursor-pointer"
            title={isExpanded ? "Collapse height" : "Expand to fit screen"}
          >
            {isExpanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
            <span>{isExpanded ? "Standard" : "Expand"}</span>
          </button>
        </div>
      </div>

      {viewMode === "list" ? (
        <List<ListRowSharedProps>
          key={`virtual-list-${columnCount}`}
          listRef={listRef}
          rowCount={rowCount}
          rowHeight={dynamicRowHeight}
          rowComponent={VirtualListRow}
          rowProps={listRowProps}
          rowKey={listRowKey}
          overscanCount={4}
          style={{
            height: resolvedHeight,
            width: "100%",
          }}
          className="virtualized-word-list outline-none select-text"
        />
      ) : (
        <List<GridRowSharedProps>
          key={`virtual-grid-${columnCount}`}
          listRef={listRef}
          rowCount={rowCount}
          rowHeight={dynamicRowHeight}
          rowComponent={VirtualGridRow}
          rowProps={gridRowProps}
          rowKey={gridRowKey}
          overscanCount={3}
          style={{
            height: resolvedHeight,
            width: "100%",
          }}
          className="virtualized-word-grid outline-none select-text"
        />
      )}
    </div>
  );
}
