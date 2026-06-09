import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import {
  listAnalysisHistorySamples,
  resolveAnalysisHistoryMedia,
  shouldShowAnalysisHistoryItem,
  type AnalysisHistoryItem,
} from "./analysisHistoryData";
import type { AnalysisWorkflowMode } from "./analysisBackend";

type AnalysisHistoryProps = {
  mode?: AnalysisWorkflowMode;
  refreshKey?: number;
  onOpenItem: (item: AnalysisHistoryItem) => void;
};

export const AnalysisHistory = memo(function AnalysisHistory({ mode = "structureAnalysis", refreshKey = 0, onOpenItem }: AnalysisHistoryProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const resizeCommitTimerRef = useRef<number | null>(null);
  const [items, setItems] = useState<AnalysisHistoryItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [historyWidth, setHistoryWidth] = useState<number | null>(null);
  const visibleItems = useMemo(() => (
    items.filter((item) => shouldShowAnalysisHistoryItem(item) && matchesHistoryMode(item, mode))
  ), [items, mode]);
  const dominoLayout = useMemo(() => buildDominoLayout(visibleItems, historyWidth), [visibleItems, historyWidth]);

  useLayoutEffect(() => {
    const element = sectionRef.current;
    if (!element) return;
    const readWidth = () => {
      const nextWidth = Math.floor(element.clientWidth);
      return nextWidth > 0 ? nextWidth : null;
    };
    const commitWidth = (nextWidth: number) => {
      setHistoryWidth((current) => current === nextWidth ? current : nextWidth);
    };
    const initialWidth = readWidth();
    if (initialWidth) commitWidth(initialWidth);
    const observer = new ResizeObserver(() => {
      const nextWidth = readWidth();
      if (!nextWidth) return;
      if (resizeCommitTimerRef.current != null) window.clearTimeout(resizeCommitTimerRef.current);
      resizeCommitTimerRef.current = window.setTimeout(() => {
        resizeCommitTimerRef.current = null;
        commitWidth(nextWidth);
      }, HISTORY_RESIZE_COMMIT_DELAY_MS);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (resizeCommitTimerRef.current != null) {
        window.clearTimeout(resizeCommitTimerRef.current);
        resizeCommitTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    setStatus("loading");

    listAnalysisHistorySamples()
      .then((nextItems) => {
        if (!mounted) return;
        setItems(nextItems);
        setStatus("ready");
      })
      .catch(() => {
        if (!mounted) return;
        setItems([]);
        setStatus("error");
      });

    return () => {
      mounted = false;
    };
  }, [refreshKey]);

  return (
    <section ref={sectionRef} className="new-ui-analysis-history" aria-label={mode === "materialRecognition" ? "素材识别历史结果" : "结构分析历史结果"}>
      <div className="new-ui-analysis-history-header">
        <h2 className="new-ui-analysis-history-title">{mode === "materialRecognition" ? "素材识别历史" : "结构分析历史"}</h2>
      </div>
      {status === "loading" ? <div className="new-ui-analysis-history-state">加载中</div> : null}
      {status === "error" ? <div className="new-ui-analysis-history-state">暂时无法读取历史结果</div> : null}
      {status === "ready" && !visibleItems.length ? <div className="new-ui-analysis-history-state">暂无历史结果</div> : null}
      {visibleItems.length && dominoLayout ? (
        <div
          className="new-ui-analysis-history-domino"
          style={{ width: dominoLayout.width, height: dominoLayout.height }}
        >
          {dominoLayout.placements.map((placement) => (
            <AnalysisHistoryCard
              key={placement.item.sampleVideoId}
              placement={placement}
              onOpen={onOpenItem}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
});

function matchesHistoryMode(item: AnalysisHistoryItem, mode: AnalysisWorkflowMode) {
  const workflowKey = item.workflowRun?.workflowKey ?? item.workflowKey ?? null;
  const structure = Boolean(item.hasFunctionSlotAtomization) || workflowKey === "full-analysis";
  const material = !structure && (workflowKey === "material-recognition" || Boolean(item.hasUserMaterialPack));
  if (mode === "materialRecognition") return material;
  if (structure) return true;
  return !material;
}

type DominoPlacement = {
  item: AnalysisHistoryItem;
  media: ReturnType<typeof resolveAnalysisHistoryMedia>;
  x: number;
  y: number;
  width: number;
  height: number;
};

type DominoLayout = {
  placements: DominoPlacement[];
  width: number;
  height: number;
};

type DominoEntry = {
  item: AnalysisHistoryItem;
  media: ReturnType<typeof resolveAnalysisHistoryMedia>;
  originalIndex: number;
};

type DominoState = {
  occupied: Set<string>;
  placements: DominoPlacement[];
  remaining: DominoEntry[];
  maxRow: number;
  maxDrift: number;
  orderPenalty: number;
  padPenalty: number;
};

const DOMINO_TARGET_CELL_SIZE = 160;
const DOMINO_LOOKAHEAD = 14;
const DOMINO_BEAM_WIDTH = 18;
const DOMINO_MIN_COLUMNS = 2;
const HISTORY_RESIZE_COMMIT_DELAY_MS = 260;

function AnalysisHistoryCard({ placement, onOpen }: { placement: DominoPlacement; onOpen: (item: AnalysisHistoryItem) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [previewing, setPreviewing] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const { item, media } = placement;
  const style: CSSProperties = {
    left: placement.x,
    top: placement.y,
    width: placement.width,
    height: placement.height,
  };
  const showCover = Boolean(media.coverUrl && !coverFailed);

  useEffect(() => {
    setCoverFailed(false);
  }, [media.coverUrl]);

  const openItem = () => {
    onOpen(item);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openItem();
  };

  const playPreview = () => {
    if (!media.videoUrl) return;
    setPreviewing(true);
    window.requestAnimationFrame(() => {
      const video = videoRef.current;
      if (!video) return;
      video.play().catch(() => undefined);
    });
  };

  const pausePreview = () => {
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    setPreviewing(false);
  };

  return (
    <article
      className={`new-ui-analysis-history-card is-${media.orientation}`}
      style={style}
      role="button"
      tabIndex={0}
      aria-label={media.title}
      onClick={openItem}
      onKeyDown={handleKeyDown}
      onPointerEnter={playPreview}
      onPointerLeave={pausePreview}
      onFocus={playPreview}
      onBlur={pausePreview}
    >
      <div className="new-ui-analysis-history-media">
        {showCover ? <img src={media.coverUrl ?? ""} alt="" loading="lazy" decoding="async" onError={() => setCoverFailed(true)} /> : <HistoryCoverPlaceholder />}
        {previewing && media.videoUrl ? <video ref={videoRef} src={media.videoUrl} muted loop playsInline preload="none" aria-hidden="true" /> : null}
        <span className={`new-ui-analysis-history-badge new-ui-analysis-history-badge-${badgeClass(media.badgeLabel)}`}>{media.badgeLabel}</span>
        <span className="new-ui-analysis-history-duration">{media.durationLabel}</span>
        <span className="new-ui-analysis-history-ratio">{media.ratioLabel}</span>
      </div>
      <div className="new-ui-analysis-history-meta">
        <span className="new-ui-analysis-history-name">{media.title}</span>
        <span className="new-ui-analysis-history-detail">{media.relativeDateLabel}</span>
      </div>
    </article>
  );
}

function HistoryCoverPlaceholder() {
  return (
    <div className="new-ui-analysis-history-placeholder" aria-hidden="true">
      <svg viewBox="0 0 96 96" focusable="false">
        <g transform="translate(-4 0) rotate(-8 37 52)">
          <path className="new-ui-analysis-history-placeholder-frame" d="M22 32h29l-6 12 8 6-6 20H22Z" />
          <path className="new-ui-analysis-history-placeholder-mountain" d="M28 61 36 52l9 11" />
        </g>
        <g transform="translate(4 0) rotate(8 59 52)">
          <path className="new-ui-analysis-history-placeholder-frame" d="M47 32h27v38H48l6-15-9-7 7-16" />
          <path className="new-ui-analysis-history-placeholder-mountain" d="M55 62 63 53l8 10" />
        </g>
      </svg>
    </div>
  );
}

function buildDominoLayout(items: AnalysisHistoryItem[], containerWidth: number | null): DominoLayout | null {
  if (!containerWidth) return null;
  const availableWidth = Math.max(320, Math.floor(containerWidth));
  const columns = Math.max(
    DOMINO_MIN_COLUMNS,
    Math.floor(availableWidth / DOMINO_TARGET_CELL_SIZE),
  );
  const cellSize = Math.floor(availableWidth / columns);
  const pitch = cellSize;
  const longSide = cellSize * 2;
  const shortSide = cellSize;
  const wallWidth = columns * cellSize;
  const initialState: DominoState = {
    occupied: new Set<string>(),
    placements: [],
    remaining: items.map((item, originalIndex) => ({ item, media: resolveAnalysisHistoryMedia(item), originalIndex })),
    maxRow: 0,
    maxDrift: 0,
    orderPenalty: 0,
    padPenalty: 0,
  };
  let beam = [initialState];

  while (beam[0]?.remaining.length) {
    const nextBeam: DominoState[] = [];
    for (const state of beam) {
      const cell = firstEmptyDominoCell(state.occupied, columns);
      const candidates = selectDominoCandidateIndexes(state.remaining, state.occupied, columns, cell);

      if (!candidates.length) {
        nextBeam.push(padDominoCell(state, cell, columns));
        continue;
      }

      for (const candidate of candidates) {
        nextBeam.push(placeDominoEntry(state, candidate.index, cell, cellSize));
      }
    }

    if (!nextBeam.length) break;
    beam = nextBeam
      .sort((a, b) => scoreDominoState(a, columns) - scoreDominoState(b, columns))
      .slice(0, DOMINO_BEAM_WIDTH);
  }
  const bestState = beam.sort((a, b) => scoreDominoState(a, columns) - scoreDominoState(b, columns))[0] ?? initialState;
  const maxBottom = bestState.placements.reduce((bottom, placement) => Math.max(bottom, placement.y + placement.height), 0);

  return {
    placements: bestState.placements,
    width: wallWidth,
    height: Math.max(0, maxBottom),
  };
}

function selectDominoCandidateIndexes(
  queue: DominoEntry[],
  occupied: Set<string>,
  columns: number,
  cell: { x: number; y: number },
) {
  return queue
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => canPlaceDominoOrientation(occupied, columns, cell, entry.media.orientation))
    .map(({ index }) => ({
      index,
      score: index < DOMINO_LOOKAHEAD ? index : DOMINO_LOOKAHEAD * 6 + index,
    }))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, Math.min(6, DOMINO_BEAM_WIDTH));
}

function placeDominoEntry(
  state: DominoState,
  entryIndex: number,
  cell: { x: number; y: number },
  cellSize: number,
): DominoState {
  const entry = state.remaining[entryIndex];
  const isLandscape = entry.media.orientation === "landscape";
  const spanX = isLandscape ? 2 : 1;
  const spanY = isLandscape ? 1 : 2;
  const occupied = new Set(state.occupied);
  for (let y = 0; y < spanY; y += 1) {
    for (let x = 0; x < spanX; x += 1) {
      occupied.add(dominoCellKey(cell.x + x, cell.y + y));
    }
  }
  const placement: DominoPlacement = {
    ...entry,
    x: cell.x * cellSize,
    y: cell.y * cellSize,
    width: isLandscape ? cellSize * 2 : cellSize,
    height: isLandscape ? cellSize : cellSize * 2,
  };
  const remaining = state.remaining.filter((_, index) => index !== entryIndex);
  return {
    occupied,
    placements: [...state.placements, placement],
    remaining,
    maxRow: Math.max(state.maxRow, cell.y + spanY),
    maxDrift: Math.max(state.maxDrift, Math.abs(entry.originalIndex - state.placements.length)),
    orderPenalty: state.orderPenalty + (entryIndex < DOMINO_LOOKAHEAD ? entryIndex : DOMINO_LOOKAHEAD * 6 + entryIndex),
    padPenalty: state.padPenalty,
  };
}

function padDominoCell(state: DominoState, cell: { x: number; y: number }, columns: number): DominoState {
  const occupied = new Set(state.occupied);
  occupied.add(dominoCellKey(cell.x, cell.y));
  return {
    ...state,
    occupied,
    maxRow: Math.max(state.maxRow, cell.y + 1),
    padPenalty: state.padPenalty + (cell.x === columns - 1 ? 180 : 4000),
  };
}

function scoreDominoState(state: DominoState, columns: number) {
  const skylinePenalty = Array.from({ length: columns }, (_, x) => {
    let top = 0;
    for (let y = 0; y < state.maxRow + 3; y += 1) {
      if (state.occupied.has(dominoCellKey(x, y))) top = y + 1;
    }
    return Math.abs(state.maxRow - top);
  }).reduce((sum, value) => sum + value, 0);
  return state.maxRow * 120 + skylinePenalty * 38 + state.orderPenalty * 9 + state.maxDrift * 16 + state.padPenalty;
}

function canPlaceDominoOrientation(
  occupied: Set<string>,
  columns: number,
  cell: { x: number; y: number },
  orientation: "landscape" | "portrait",
) {
  if (orientation === "landscape") {
    return cell.x + 1 < columns
      && !occupied.has(dominoCellKey(cell.x, cell.y))
      && !occupied.has(dominoCellKey(cell.x + 1, cell.y));
  }
  return !occupied.has(dominoCellKey(cell.x, cell.y))
    && !occupied.has(dominoCellKey(cell.x, cell.y + 1));
}

function firstEmptyDominoCell(occupied: Set<string>, columns: number) {
  for (let y = 0; y < 10000; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      if (!occupied.has(dominoCellKey(x, y))) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

function dominoCellKey(x: number, y: number) {
  return `${x}:${y}`;
}

function badgeClass(label: "已完成" | "分析中" | "识别中" | "未完成") {
  if (label === "已完成") return "complete";
  if (label === "未完成") return "incomplete";
  return "pending";
}
