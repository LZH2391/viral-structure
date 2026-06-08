import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from "react";
import { runtimeUrl } from "../../api/client";
import { formatSecondsCompact, sanitizeText } from "../../utils/format";
import type { AnalysisHistoryItem } from "./analysisHistoryData";
import type { AnalysisTimelineSegmentDetail } from "./analysisTimelineSelection";

type AnalysisTimelineTrackTone =
  | "shot"
  | "script"
  | "rhythm"
  | "packaging"
  | "slot"
  | "materialClass"
  | "materialFunction"
  | "materialProof"
  | "materialSequence";

type AnalysisTimelineBlock = {
  id: string;
  label: string;
  start: number;
  end: number;
  frameUrls?: string[];
  shotBoundaryPercents?: number[];
  shotRangeLabel?: string | null;
  detail?: AnalysisTimelineSegmentDetail;
};

type AnalysisTimelineTrack = {
  key: AnalysisTimelineTrackTone;
  label: string;
  emptyLabel: string;
  blocks: AnalysisTimelineBlock[];
};

type VideoFrameCallbackVideo = {
  requestVideoFrameCallback: (callback: (now: number, metadata: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

const TIMELINE_READY_TIMEOUT_MS = 1600;

export function AnalysisTimelineTracks({
  item,
  modeHint,
  mediaKey,
  active = true,
  videoRef,
  selectedSegmentId,
  onSeek,
  onReady,
  onSelectSegment,
}: {
  item: AnalysisHistoryItem | null;
  modeHint?: "material" | "structure" | null;
  mediaKey: string;
  active?: boolean;
  videoRef: RefObject<HTMLVideoElement>;
  selectedSegmentId?: string | null;
  onSeek: (time: number) => void;
  onReady?: () => void;
  onSelectSegment?: (segment: AnalysisTimelineSegmentDetail) => void;
}) {
  const timelineRef = useRef<HTMLElement>(null);
  const playheadScaleRef = useRef<HTMLDivElement>(null);
  const draggingPlayheadRef = useRef(false);
  const [draggingPlayhead, setDraggingPlayhead] = useState(false);
  const { duration, subtitleBlocks, tracks } = useMemo(() => resolveAnalysisTimelineTracks(item, modeHint), [item, modeHint]);
  const ticks = useMemo(() => resolveTimelineTicks(duration), [duration]);
  const shotCount = tracks.find((track) => track.key === "shot")?.blocks.length ?? 0;
  const timelineBlockCount = subtitleBlocks.length + tracks.reduce((sum, track) => sum + track.blocks.length, 0);
  const timelineReadySignature = useMemo(() => {
    const frameCount = tracks.reduce((sum, track) => sum + track.blocks.reduce((trackSum, block) => trackSum + (block.frameUrls?.length ?? 0), 0), 0);
    return `${mediaKey}:${timelineBlockCount}:${frameCount}`;
  }, [mediaKey, timelineBlockCount, tracks]);

  const seekFromPlayheadClientX = (clientX: number) => {
    const scale = playheadScaleRef.current;
    if (!scale) return;
    const time = resolveTimelinePointerTimeFromScale(scale, clientX, duration);
    timelineRef.current?.style.setProperty("--new-ui-analysis-nav-left", `${timelineTimePercent(time, duration)}%`);
    onSeek(time);
  };

  const startTimelineDrag = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingPlayheadRef.current = true;
    setDraggingPlayhead(true);
    seekFromPlayheadClientX(event.clientX);
  };

  const moveTimelineDrag = (event: PointerEvent<HTMLElement>) => {
    if (!draggingPlayheadRef.current) return;
    event.preventDefault();
    seekFromPlayheadClientX(event.clientX);
  };

  const finishTimelineDrag = (event: PointerEvent<HTMLElement>) => {
    if (!draggingPlayheadRef.current) return;
    event.preventDefault();
    draggingPlayheadRef.current = false;
    setDraggingPlayhead(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
    seekFromPlayheadClientX(event.clientX);
  };

  const startPlayheadDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingPlayheadRef.current = true;
    setDraggingPlayhead(true);
    seekFromPlayheadClientX(event.clientX);
  };

  const movePlayheadDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!draggingPlayheadRef.current) return;
    seekFromPlayheadClientX(event.clientX);
  };

  const finishPlayheadDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!draggingPlayheadRef.current) return;
    draggingPlayheadRef.current = false;
    setDraggingPlayhead(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
    seekFromPlayheadClientX(event.clientX);
  };

  useEffect(() => {
    const timeline = timelineRef.current;
    const video = videoRef.current;
    if (!active || !timeline) return undefined;

    const updateNavigationLine = (time: number) => {
      timeline.style.setProperty("--new-ui-analysis-nav-left", `${timelineTimePercent(time, duration)}%`);
    };
    updateNavigationLine(video?.currentTime ?? 0);

    if (!video) return undefined;

    let frameHandle = 0;
    let animationHandle = 0;
    const scheduleFrame = () => {
      if (hasVideoFrameCallback(video)) {
        const frameCallbackVideo = video as HTMLVideoElement & VideoFrameCallbackVideo;
        frameHandle = frameCallbackVideo.requestVideoFrameCallback((_now, metadata) => {
          updateNavigationLine(metadata.mediaTime);
          scheduleFrame();
        });
        return;
      }
      animationHandle = window.requestAnimationFrame(() => {
        updateNavigationLine(video.currentTime);
        scheduleFrame();
      });
    };
    scheduleFrame();

    const sync = () => updateNavigationLine(video.currentTime);
    video.addEventListener("loadedmetadata", sync);
    video.addEventListener("seeking", sync);
    video.addEventListener("seeked", sync);

    return () => {
      if (frameHandle && hasVideoFrameCallback(video)) (video as HTMLVideoElement & VideoFrameCallbackVideo).cancelVideoFrameCallback?.(frameHandle);
      if (animationHandle) window.cancelAnimationFrame(animationHandle);
      video.removeEventListener("loadedmetadata", sync);
      video.removeEventListener("seeking", sync);
      video.removeEventListener("seeked", sync);
    };
  }, [active, duration, mediaKey, videoRef]);

  useEffect(() => {
    if (!active || !onReady || timelineBlockCount <= 0) return undefined;
    const timeline = timelineRef.current;
    if (!timeline) return undefined;
    let cancelled = false;
    const animationFrameIds: number[] = [];
    const timeoutId = window.setTimeout(() => {
      if (!cancelled) signalTimelineReadyAfterPaint(onReady, animationFrameIds);
    }, TIMELINE_READY_TIMEOUT_MS);
    const imageElements = Array.from(timeline.querySelectorAll<HTMLImageElement>(".new-ui-analysis-shot-frame"));
    Promise.all(imageElements.map(waitForImageDecode))
      .then(() => {
        if (cancelled) return;
        window.clearTimeout(timeoutId);
        signalTimelineReadyAfterPaint(onReady, animationFrameIds);
      })
      .catch(() => {
        if (cancelled) return;
        window.clearTimeout(timeoutId);
        signalTimelineReadyAfterPaint(onReady, animationFrameIds);
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      animationFrameIds.forEach((id) => window.cancelAnimationFrame(id));
    };
  }, [active, onReady, timelineBlockCount, timelineReadySignature]);

  return (
    <section ref={timelineRef} className="new-ui-analysis-timeline" aria-label="分析轨道">
      <header className="new-ui-analysis-timeline-header">
        <h2>时间轴</h2>
        <span>{formatTimelineTime(duration)} · {shotCount} 镜头</span>
      </header>
      <div className="new-ui-analysis-timeline-body">
        <div className="new-ui-analysis-timeline-ruler" aria-hidden="true">
          <div className="new-ui-analysis-timeline-ruler-label">
            <span className="new-ui-analysis-timeline-label-text">时间轨</span>
          </div>
          <div
            className="new-ui-analysis-timeline-ruler-lane"
            onPointerDown={startTimelineDrag}
            onPointerMove={moveTimelineDrag}
            onPointerUp={finishTimelineDrag}
            onPointerCancel={finishTimelineDrag}
          >
            <div className="new-ui-analysis-timeline-lane-scale">
              {ticks.map((tick) => (
                <span key={tick} style={timelineTickStyle(tick, duration)}>{formatTimelineTick(tick)}</span>
              ))}
            </div>
          </div>
        </div>
        <div className="new-ui-analysis-timeline-subtitle-row">
          <div className="new-ui-analysis-timeline-label">
            <span className="new-ui-analysis-timeline-label-text">字幕轨</span>
          </div>
          <div
            className="new-ui-analysis-timeline-lane"
            onPointerDown={startTimelineDrag}
            onPointerMove={moveTimelineDrag}
            onPointerUp={finishTimelineDrag}
            onPointerCancel={finishTimelineDrag}
          >
            <div className="new-ui-analysis-timeline-lane-scale">
              {subtitleBlocks.map((block) => (
                <SubtitleTimelineBlock key={block.id} block={block} duration={duration} selected={selectedSegmentId === block.detail?.id} onSeek={onSeek} onSelect={onSelectSegment} />
              ))}
            </div>
            {!subtitleBlocks.length && <span className="new-ui-analysis-timeline-empty">暂无字幕</span>}
          </div>
        </div>
        <div className="new-ui-analysis-timeline-rows">
          {tracks.map((track) => (
            <div key={track.key} className={`new-ui-analysis-timeline-row is-${track.key}`}>
              <div className="new-ui-analysis-timeline-label">
                <span className="new-ui-analysis-timeline-label-text">{track.label}</span>
              </div>
              <div
                className="new-ui-analysis-timeline-lane"
                onPointerDown={startTimelineDrag}
                onPointerMove={moveTimelineDrag}
                onPointerUp={finishTimelineDrag}
                onPointerCancel={finishTimelineDrag}
              >
                <div className="new-ui-analysis-timeline-lane-scale">
                  {track.blocks.map((block) => (
                    track.key === "shot" ? (
                      <ShotTimelineBlock key={block.id} block={block} duration={duration} selected={selectedSegmentId === block.detail?.id} onSeek={onSeek} onSelect={onSelectSegment} />
                    ) : track.key === "script" || track.key === "rhythm" || track.key === "packaging" || track.key === "slot" || track.key === "materialClass" || track.key === "materialFunction" || track.key === "materialProof" || track.key === "materialSequence" ? (
                      <StructureTimelineBlock key={block.id} block={block} duration={duration} selected={selectedSegmentId === block.detail?.id} onSelect={onSelectSegment} />
                    ) : (
                      <button
                        key={block.id}
                        className={`new-ui-analysis-timeline-block ${selectedSegmentId === block.detail?.id ? "is-selected" : ""}`.trim()}
                        type="button"
                        style={timelineBlockStyle(block, duration)}
                        data-tooltip={`${block.label} ${formatTimelineTime(block.start)}-${formatTimelineTime(block.end)}`}
                        onPointerDown={stopTimelineBlockPointerDown}
                        onClick={() => {
                          if (block.detail) onSelectSegment?.(block.detail);
                        }}
                      >
                        {block.label}
                      </button>
                    )
                  ))}
                </div>
                {!track.blocks.length && <span className="new-ui-analysis-timeline-empty">{track.emptyLabel}</span>}
              </div>
            </div>
          ))}
        </div>
        <div className="new-ui-analysis-timeline-playhead-layer">
          <div ref={playheadScaleRef} className="new-ui-analysis-timeline-playhead-scale">
            <button
              className={`new-ui-analysis-timeline-playhead ${draggingPlayhead ? "is-dragging" : ""}`.trim()}
              type="button"
              aria-label="当前播放位置"
              data-tooltip="拖动调整播放位置"
              onPointerDown={startPlayheadDrag}
              onPointerMove={movePlayheadDrag}
              onPointerUp={finishPlayheadDrag}
              onPointerCancel={finishPlayheadDrag}
            >
              <svg className="new-ui-analysis-timeline-playhead-line-svg" viewBox="0 0 18 100" preserveAspectRatio="none" focusable="false" aria-hidden="true">
                <line className="new-ui-analysis-timeline-playhead-line" x1="9" y1="0" x2="9" y2="100" />
              </svg>
              <svg className="new-ui-analysis-timeline-playhead-handle-svg" viewBox="0 0 18 18" preserveAspectRatio="xMidYMin meet" focusable="false" aria-hidden="true">
                <path className="new-ui-analysis-timeline-playhead-handle" d="M4.8 1.2H13.2V10.2L9 16.8L4.8 10.2Z" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function signalTimelineReadyAfterPaint(onReady: () => void, animationFrameIds: number[]) {
  const firstFrameId = window.requestAnimationFrame(() => {
    const secondFrameId = window.requestAnimationFrame(onReady);
    animationFrameIds.push(secondFrameId);
  });
  animationFrameIds.push(firstFrameId);
}

function waitForImageDecode(image: HTMLImageElement) {
  const waitForLoad = image.complete
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
      const done = () => resolve();
      image.addEventListener("load", done, { once: true });
      image.addEventListener("error", done, { once: true });
    });
  return waitForLoad
    .then(() => image.decode?.().catch(() => undefined))
    .then(() => undefined);
}

function StructureTimelineBlock({
  block,
  duration,
  selected,
  onSelect,
}: {
  block: AnalysisTimelineBlock;
  duration: number;
  selected: boolean;
  onSelect?: (segment: AnalysisTimelineSegmentDetail) => void;
}) {
  return (
    <button
      className={`new-ui-analysis-timeline-block new-ui-analysis-structure-block ${selected ? "is-selected" : ""}`.trim()}
      type="button"
      style={timelineBlockStyle(block, duration)}
      data-tooltip={`${block.label} ${formatTimelineTime(block.start)}-${formatTimelineTime(block.end)}${block.shotRangeLabel ? ` · ${block.shotRangeLabel}` : ""}`}
      onPointerDown={stopTimelineBlockPointerDown}
      onClick={() => {
        if (block.detail) onSelect?.(block.detail);
      }}
    >
      <span className="new-ui-analysis-structure-ticks" aria-hidden="true">
        {(block.shotBoundaryPercents ?? []).map((left, index) => (
          <span key={`${block.id}-tick-${index}-${left}`} className="new-ui-analysis-structure-tick" style={{ left: `${left}%` }} />
        ))}
      </span>
      <span className="new-ui-analysis-structure-label">{block.label}</span>
      {block.shotRangeLabel ? <span className="new-ui-analysis-structure-range">{block.shotRangeLabel}</span> : null}
    </button>
  );
}

function ShotTimelineBlock({
  block,
  duration,
  selected,
  onSeek,
  onSelect,
}: {
  block: AnalysisTimelineBlock;
  duration: number;
  selected: boolean;
  onSeek: (time: number) => void;
  onSelect?: (segment: AnalysisTimelineSegmentDetail) => void;
}) {
  const frameUrls = block.frameUrls ?? [];
  return (
    <button
      className={`new-ui-analysis-timeline-block new-ui-analysis-shot-block ${frameUrls.length ? "has-frames" : ""} ${selected ? "is-selected" : ""}`.trim()}
      type="button"
      style={timelineBlockStyle(block, duration)}
      data-tooltip={`${block.label} ${formatTimelineTime(block.start)}-${formatTimelineTime(block.end)}`}
      onPointerDown={stopTimelineBlockPointerDown}
      onClick={() => {
        onSeek(block.start);
        if (block.detail) onSelect?.(block.detail);
      }}
    >
      <span className="new-ui-analysis-shot-label">{formatShotLabel(block.label)}</span>
      {frameUrls.length ? (
        <span className="new-ui-analysis-shot-frames" aria-hidden="true">
          {frameUrls.map((url, index) => (
            <img key={`${block.id}-${index}-${url}`} className="new-ui-analysis-shot-frame" alt="" src={url} loading="lazy" />
          ))}
        </span>
      ) : null}
    </button>
  );
}

function SubtitleTimelineBlock({
  block,
  duration,
  selected,
  onSeek,
  onSelect,
}: {
  block: AnalysisTimelineBlock;
  duration: number;
  selected: boolean;
  onSeek: (time: number) => void;
  onSelect?: (segment: AnalysisTimelineSegmentDetail) => void;
}) {
  return (
    <button
      className={`new-ui-analysis-timeline-block new-ui-analysis-subtitle-block ${selected ? "is-selected" : ""}`.trim()}
      type="button"
      style={timelineBlockStyle(block, duration)}
      data-tooltip={`${block.label} ${formatTimelineTime(block.start)}-${formatTimelineTime(block.end)}`}
      onPointerDown={stopTimelineBlockPointerDown}
      onClick={() => {
        onSeek(block.start);
        if (block.detail) onSelect?.(block.detail);
      }}
    >
      <span>{block.label}</span>
    </button>
  );
}

function stopTimelineBlockPointerDown(event: PointerEvent<HTMLButtonElement>) {
  event.stopPropagation();
}

function hasVideoFrameCallback(video: HTMLVideoElement) {
  return typeof (video as Partial<VideoFrameCallbackVideo>).requestVideoFrameCallback === "function";
}

function resolveAnalysisTimelineTracks(item: AnalysisHistoryItem | null, modeHint: "material" | "structure" | null = null): { duration: number; subtitleBlocks: AnalysisTimelineBlock[]; tracks: AnalysisTimelineTrack[] } {
  const artifact = item?.artifact;
  const shots = artifact?.shotBoundaryAnalysis?.shots ?? [];
  const subtitles = artifact?.subtitles ?? null;
  const userMaterialPack = artifact?.userMaterialPack ?? null;
  const hasStructureResult = Boolean(artifact?.functionSlotAtomizationAnalysis || item?.hasFunctionSlotAtomization || modeHint === "structure");
  const shouldUseMaterialTimeline = Boolean(
    (modeHint === "material" || userMaterialPack || item?.hasUserMaterialPack)
      && !hasStructureResult,
  );
  const scriptSegments = artifact?.scriptSegmentAnalysis?.segments ?? [];
  const rhythmSections = artifact?.rhythmStructureAnalysis?.sections ?? [];
  const packagingBlocks = artifact?.packagingStructureAnalysis?.packagingBlocks ?? [];
  const slots = artifact?.functionSlotAtomizationAnalysis?.slotMap?.slots ?? [];
  const frames = artifact?.frames ?? [];
  const materialCardByShot = buildMaterialCardByShot(userMaterialPack?.shotCards);
  const shotMeta = buildShotTimelineMeta(shots);
  const shotBlocks = shots.map((shot) => ({
    id: shot.id,
    label: formatShotNo(shot.shotNo, shot.index),
    start: shot.start,
    end: shot.end,
    frameUrls: resolveShotFrameUrls(shot.start, shot.end, frames),
    detail: resolveShotTimelineDetail(shot, materialCardByShot.get(shot.id) ?? (shot.shotNo ? materialCardByShot.get(shot.shotNo) : undefined)),
  }));
  const subtitleBlocks = resolveSubtitleTimelineBlocks(subtitles);
  const materialTracks = shouldUseMaterialTimeline
    ? resolveMaterialTimelineTracks(userMaterialPack, shotMeta, shotBlocks)
    : null;
  const scriptBlocks = scriptSegments.map((segment) => ({
    id: segment.segmentId,
    label: segment.label,
    start: segment.start,
    end: segment.end,
    ...withStructureDetailMeta({
      id: segment.segmentId,
      tone: "script",
      label: segment.label,
      start: segment.start,
      end: segment.end,
      shotRefs: segment.shotRefs,
      shotMeta,
      summary: segment.roleInScript || segment.transferableRule || "这个脚本段还没有摘要。",
      fields: [
        { label: "脚本作用", value: segment.roleInScript },
        { label: "迁移规则", value: segment.transferableRule },
        { label: "证据", value: segment.evidence.join(" / ") },
      ],
    }),
  }));
  const rhythmBlocks = rhythmSections.map((section) => ({
    id: section.sectionId,
    label: section.label,
    start: section.start,
    end: section.end,
    ...withStructureDetailMeta({
      id: section.sectionId,
      tone: "rhythm",
      label: section.label,
      start: section.start,
      end: section.end,
      shotRefs: section.shotRefs,
      shotMeta,
      summary: fieldPreview(section.fields) || "这个节奏段还没有摘要。",
      fields: section.fields,
    }),
  }));
  const packagingTimelineBlocks = packagingBlocks.map((block) => ({
    id: block.blockId,
    label: block.label,
    start: block.start,
    end: block.end,
    ...withStructureDetailMeta({
      id: block.blockId,
      tone: "packaging",
      label: block.label,
      start: block.start,
      end: block.end,
      shotRefs: block.shotRefs,
      shotMeta,
      summary: block.packagingFunction || fieldPreview(block.fields) || "这个包装段还没有摘要。",
      fields: [
        { label: "包装作用", value: block.packagingFunction },
        ...block.fields,
      ],
    }),
  }));
  const slotBlocks = resolveSlotTimelineBlocks(slots, shots);
  const materialBlocks = materialTracks?.flatMap((track) => track.blocks) ?? [];
  const duration = Math.max(
    positiveTimelineNumber(artifact?.metadata.durationSeconds),
    maxTimelineEnd(shotBlocks),
    maxTimelineEnd(subtitleBlocks),
    maxTimelineEnd(materialBlocks),
    maxTimelineEnd(scriptBlocks),
    maxTimelineEnd(rhythmBlocks),
    maxTimelineEnd(packagingTimelineBlocks),
    maxTimelineEnd(slotBlocks),
    1,
  );

  return {
    duration,
    subtitleBlocks,
    tracks: materialTracks ?? [
      { key: "shot", label: "镜头轨", emptyLabel: "暂无切镜", blocks: shotBlocks },
      { key: "script", label: "脚本段", emptyLabel: "暂无脚本段", blocks: scriptBlocks },
      { key: "rhythm", label: "节奏段", emptyLabel: "暂无节奏段", blocks: rhythmBlocks },
      { key: "packaging", label: "包装段", emptyLabel: "暂无包装段", blocks: packagingTimelineBlocks },
      { key: "slot", label: "槽位段", emptyLabel: "暂无槽位段", blocks: slotBlocks },
    ],
  };
}

function resolveSubtitleTimelineBlocks(subtitles: NonNullable<AnalysisHistoryItem["artifact"]>["subtitles"] | null | undefined): AnalysisTimelineBlock[] {
  const sourceSegments = subtitles?.segments?.length
    ? subtitles.segments
    : subtitles?.utterances?.map((utterance, index) => ({
      id: `utterance_${index}_${utterance.start}`,
      start: utterance.start,
      end: utterance.end,
      text: utterance.text,
    })) ?? [];

  return sourceSegments
    .map((segment, index) => {
      const start = positiveTimelineNumber(segment.start);
      const rawEnd = positiveTimelineNumber(segment.end);
      const text = timelineDetailText(segment.text);
      const labelText = sanitizeText(segment.text, 96);
      const end = rawEnd > start ? rawEnd : start + estimateSubtitleDuration(text);
      const block: AnalysisTimelineBlock = {
        id: String(segment.id ?? `subtitle_${index}`),
        label: labelText || `字幕 ${index + 1}`,
        start,
        end,
        detail: {
          id: `subtitle:${String(segment.id ?? `subtitle_${index}`)}`,
          tone: "subtitle",
          title: text || `字幕 ${index + 1}`,
          timeLabel: `${formatTimelineTime(start)} - ${formatTimelineTime(end)}`,
          shotRangeLabel: null,
          summary: text || "这条字幕没有文本内容。",
          fields: [],
        },
      };
      return block;
    })
    .filter((block) => block.end > block.start)
    .sort((a, b) => a.start - b.start);
}

function resolveMaterialTimelineTracks(
  materialPack: NonNullable<NonNullable<AnalysisHistoryItem["artifact"]>["userMaterialPack"]> | null,
  shotMeta: Map<string, { index: number; label: string; start: number; end: number }>,
  shotBlocks: AnalysisTimelineBlock[],
): AnalysisTimelineTrack[] {
  const proofByShot = buildProofCoverageByShot(asArray(materialPack?.proofCoverage));
  const sequenceByShot = buildSequenceRecommendationByShot(materialPack?.sequenceRecommendations);
  const cards = [...asArray(materialPack?.shotCards)].sort((a, b) => {
    const left = shotMeta.get(a.shotRef)?.index ?? Number.MAX_SAFE_INTEGER;
    const right = shotMeta.get(b.shotRef)?.index ?? Number.MAX_SAFE_INTEGER;
    return left - right;
  });

  const classBlocks: AnalysisTimelineBlock[] = [];
  const functionBlocks: AnalysisTimelineBlock[] = [];
  const proofBlocks: AnalysisTimelineBlock[] = [];
  const sequenceBlocks: AnalysisTimelineBlock[] = [];

  cards.forEach((card, index) => {
    const range = resolveMaterialCardTimeRange(card, shotMeta, index);
    if (!range) return;
    const shotLabel = card.shotNo || range.label || formatShotNo(card.shotRef, index);
    const proofItems = proofByShot.get(card.shotRef) ?? [];
    const sequenceItems = sequenceByShot.get(card.shotRef) ?? [];
    const shotFunctions = asArray(card.shotFunctions);
    const materialTags = asArray(card.materialTags);
    const materialFields = materialCardBaseFields(card);

    classBlocks.push({
      id: `material-class:${card.shotRef}`,
      label: materialClassLabel(card.shotClass),
      start: range.start,
      end: range.end,
      shotRangeLabel: shotLabel,
      detail: materialDetail({
        id: `material-class:${card.shotRef}`,
        tone: "materialClass",
        title: materialClassLabel(card.shotClass),
        start: range.start,
        end: range.end,
        shotLabel,
        summary: card.visualSummary || card.spokenOrSubtitleSummary || "这个镜头还没有素材摘要。",
        fields: [
          { label: "镜头类型", value: card.shotClass },
          { label: "画面摘要", value: card.visualSummary },
          { label: "口播/字幕", value: card.spokenOrSubtitleSummary },
          ...materialFields,
        ],
      }),
    });

    functionBlocks.push({
      id: `material-function:${card.shotRef}`,
      label: materialFunctionLabel(shotFunctions),
      start: range.start,
      end: range.end,
      shotRangeLabel: shotLabel,
      detail: materialDetail({
        id: `material-function:${card.shotRef}`,
        tone: "materialFunction",
        title: materialFunctionLabel(shotFunctions),
        start: range.start,
        end: range.end,
        shotLabel,
        summary: shotFunctions.length ? `这个镜头可用于${materialFunctionLabel(shotFunctions)}。` : "这个镜头还没有表达功能标签。",
        fields: [
          { label: "表达功能", value: shotFunctions.map(materialFunctionLabel).join(" / ") },
          { label: "素材标签", value: materialTags.join(" / ") },
          ...materialFields,
        ],
      }),
    });

    proofBlocks.push({
      id: `material-proof:${card.shotRef}`,
      label: materialProofLabel(proofItems),
      start: range.start,
      end: range.end,
      shotRangeLabel: shotLabel,
      detail: materialDetail({
        id: `material-proof:${card.shotRef}`,
        tone: "materialProof",
        title: materialProofLabel(proofItems),
        start: range.start,
        end: range.end,
        shotLabel,
        summary: materialProofSummary(proofItems),
        fields: [
          { label: "证明覆盖", value: proofItems.map((item) => `${materialProofNeedLabel(item.proofNeedClass)}：${materialCoverageLabel(item.coverage)}`).join(" / ") },
          { label: "证明理由", value: proofItems.map((item) => item.reason).filter(Boolean).join(" / ") },
          ...materialFields,
        ],
      }),
    });

    sequenceBlocks.push({
      id: `material-sequence:${card.shotRef}`,
      label: materialSequenceLabel(sequenceItems),
      start: range.start,
      end: range.end,
      shotRangeLabel: shotLabel,
      detail: materialDetail({
        id: `material-sequence:${card.shotRef}`,
        tone: "materialSequence",
        title: materialSequenceLabel(sequenceItems),
        start: range.start,
        end: range.end,
        shotLabel,
        summary: materialSequenceSummary(sequenceItems),
        fields: [
          { label: "位置建议", value: sequenceItems.map((item) => `${materialPositionLabel(item.recommendedPosition)}：${materialFitLabel(item.fit)}`).join(" / ") },
          { label: "建议理由", value: sequenceItems.map((item) => item.reason).filter(Boolean).join(" / ") },
          { label: "不适合", value: sequenceItems.flatMap((item) => asArray(item.doNotUseAs)).join(" / ") },
          ...materialFields,
        ],
      }),
    });
  });

  return [
    { key: "shot", label: "镜头轨", emptyLabel: "暂无切镜", blocks: shotBlocks },
    { key: "materialClass", label: "镜头类型", emptyLabel: "暂无镜头类型", blocks: classBlocks },
    { key: "materialFunction", label: "表达功能", emptyLabel: "暂无表达功能", blocks: functionBlocks },
    { key: "materialProof", label: "证明支撑", emptyLabel: "暂无证明支撑", blocks: proofBlocks },
    { key: "materialSequence", label: "成片位置", emptyLabel: "暂无位置建议", blocks: sequenceBlocks },
  ];
}

function resolveMaterialCardTimeRange(
  card: MaterialShotCard,
  shotMeta: Map<string, { index: number; label: string; start: number; end: number }>,
  index: number,
) {
  const meta = shotMeta.get(card.shotRef) ?? (card.shotNo ? shotMeta.get(card.shotNo) : undefined);
  if (meta) return meta;
  const start = positiveTimelineNumber(card.timeRange?.start);
  const end = positiveTimelineNumber(card.timeRange?.end);
  if (end > start) return { index, label: card.shotNo ?? formatShotNo(card.shotRef, index), start, end };
  return null;
}

function materialDetail({
  id,
  tone,
  title,
  start,
  end,
  shotLabel,
  summary,
  fields,
}: {
  id: string;
  tone: Exclude<AnalysisTimelineTrackTone, "shot" | "script" | "rhythm" | "packaging" | "slot">;
  title: string;
  start: number;
  end: number;
  shotLabel: string;
  summary: string;
  fields: Array<{ label: string; value: string | null | undefined }>;
}): AnalysisTimelineSegmentDetail {
  return {
    id,
    tone,
    title,
    timeLabel: `${formatTimelineTime(start)} - ${formatTimelineTime(end)}`,
    shotRangeLabel: shotLabel,
    summary: timelineDetailText(summary),
    fields: compactTimelineDetailFields(fields),
  };
}

function materialCardBaseFields(card: MaterialShotCard) {
  return [
    { label: "限制引用", value: asArray(card.constraintRefs).join(" / ") },
  ];
}

function buildProofCoverageByShot(proofCoverage: MaterialProofCoverage[]) {
  const byShot = new Map<string, MaterialProofCoverage[]>();
  proofCoverage.forEach((item) => {
    asArray(item.candidateShots).forEach((shotRef) => {
      const current = byShot.get(shotRef) ?? [];
      current.push(item);
      byShot.set(shotRef, current);
    });
  });
  return byShot;
}

function buildSequenceRecommendationByShot(sequence: NonNullable<NonNullable<AnalysisHistoryItem["artifact"]>["userMaterialPack"]>["sequenceRecommendations"] | null | undefined) {
  const byShot = new Map<string, MaterialSequenceCandidate[]>();
  [
    ...asArray(sequence?.openingCandidates),
    ...asArray(sequence?.middleCandidates),
    ...asArray(sequence?.endingCandidates),
  ].forEach((item) => {
    const current = byShot.get(item.shotRef) ?? [];
    current.push(item);
    byShot.set(item.shotRef, current);
  });
  return byShot;
}

function materialClassLabel(value: string | null | undefined) {
  const labels: Record<string, string> = {
    product_display: "商品展示",
    usage_process: "使用过程",
    problem_scene: "问题场景",
    result_or_state: "结果状态",
    comparison: "对比",
    trust_evidence: "信任证据",
    human_presence: "人物",
    scene_context: "场景",
    transition_or_filler: "过渡",
    unusable: "不可用",
  };
  return labels[String(value ?? "")] ?? (sanitizeText(value, 12) || "未分类");
}

function materialFunctionLabel(values: string[] | string | null | undefined) {
  const source = Array.isArray(values) ? values : [values].filter(Boolean);
  const labels: Record<string, string> = {
    attention_entry: "吸引",
    context_setup: "铺垫",
    problem_visibility: "问题",
    product_visibility: "商品",
    operation_demonstration: "演示",
    process_continuity: "过程",
    result_visibility: "结果",
    comparison_support: "对比",
    trust_support: "信任",
    mechanism_support: "机制",
    emotion_or_reaction: "反应",
    conversion_support: "转化",
    visual_bridge: "衔接",
  };
  const mapped = source.map((value) => labels[String(value)] ?? sanitizeText(value, 8)).filter(Boolean);
  return mapped.slice(0, 2).join(" / ") || "未标注";
}

function materialProofLabel(items: MaterialProofCoverage[]) {
  if (!items.length) return "无证明";
  return items
    .filter((item) => item.coverage !== "missing")
    .map((item) => materialProofNeedLabel(item.proofNeedClass))
    .slice(0, 2)
    .join(" / ") || "弱证明";
}

function materialProofSummary(items: MaterialProofCoverage[]) {
  if (!items.length) return "这个镜头暂未进入证明候选。";
  return items.map((item) => `${materialProofNeedLabel(item.proofNeedClass)}：${item.reason || materialCoverageLabel(item.coverage)}`).join(" / ");
}

function materialProofNeedLabel(value: string) {
  const labels: Record<string, string> = {
    problem_visibility: "问题",
    product_identity: "商品识别",
    process_demonstration: "过程演示",
    mechanism_support: "机制",
    result_evidence: "结果",
    comparison_evidence: "对比",
    trust_evidence: "信任",
    conversion_support: "转化",
  };
  return labels[value] ?? sanitizeText(value, 10);
}

function materialCoverageLabel(value: string) {
  const labels: Record<string, string> = {
    strong: "强",
    partial: "部分",
    weak: "弱",
    missing: "缺失",
    unknown: "未知",
  };
  return labels[value] ?? sanitizeText(value, 8);
}

function materialSequenceLabel(items: MaterialSequenceCandidate[]) {
  if (!items.length) return "待定";
  return items.map((item) => materialPositionLabel(item.recommendedPosition)).slice(0, 2).join(" / ");
}

function materialSequenceSummary(items: MaterialSequenceCandidate[]) {
  if (!items.length) return "这个镜头暂未进入开头、中段或结尾候选。";
  return items.map((item) => `${materialPositionLabel(item.recommendedPosition)}：${item.reason || materialFitLabel(item.fit)}`).join(" / ");
}

function materialPositionLabel(value: string) {
  const labels: Record<string, string> = {
    opening: "开头",
    middle: "中段",
    ending: "结尾",
  };
  return labels[value] ?? sanitizeText(value, 8);
}

function materialFitLabel(value: string) {
  const labels: Record<string, string> = {
    strong: "强",
    medium: "中",
    weak: "弱",
  };
  return labels[value] ?? sanitizeText(value, 8);
}

function formatMaterialConfidence(value: number) {
  if (!Number.isFinite(value)) return null;
  return `${Math.round(value * 100)}%`;
}

function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function estimateSubtitleDuration(text: string) {
  const length = Math.max(1, text.length);
  return Math.min(4, Math.max(1.2, length / 8));
}

type MaterialShotCard = NonNullable<NonNullable<AnalysisHistoryItem["artifact"]>["userMaterialPack"]>["shotCards"][number];
type MaterialProofCoverage = NonNullable<NonNullable<AnalysisHistoryItem["artifact"]>["userMaterialPack"]>["proofCoverage"][number];
type MaterialSequenceCandidate = NonNullable<NonNullable<AnalysisHistoryItem["artifact"]>["userMaterialPack"]>["sequenceRecommendations"]["openingCandidates"][number];
type ShotBoundaryShot = NonNullable<NonNullable<AnalysisHistoryItem["artifact"]>["shotBoundaryAnalysis"]>["shots"][number];

function resolveShotTimelineDetail(shot: ShotBoundaryShot, materialCard: MaterialShotCard | undefined): AnalysisTimelineSegmentDetail {
  const label = formatShotNo(shot.shotNo, shot.index);
  const summary = shot.summary || shot.reason || materialCard?.visualSummary || "这个镜头还没有摘要。";
  const shotFunctions = asArray(materialCard?.shotFunctions);
  return {
    id: `shot:${shot.id}`,
    tone: "shot",
    title: label,
    timeLabel: `${formatTimelineTime(shot.start)} - ${formatTimelineTime(shot.end)}`,
    shotRangeLabel: label,
    summary: timelineDetailText(summary),
    fields: compactTimelineDetailFields([
      { label: "镜头摘要", value: shot.summary },
      { label: "切分原因", value: shot.reason },
      { label: "边界原因", value: shot.endBoundaryReason },
      { label: "素材类型", value: materialCard ? materialClassLabel(materialCard.shotClass) : null },
      { label: "表达功能", value: shotFunctions.length ? shotFunctions.map(materialFunctionLabel).join(" / ") : null },
      { label: "素材摘要", value: materialCard?.visualSummary || materialCard?.spokenOrSubtitleSummary },
    ]),
  };
}

function buildMaterialCardByShot(cards: MaterialShotCard[] | null | undefined) {
  const byShot = new Map<string, MaterialShotCard>();
  asArray(cards).forEach((card, index) => {
    byShot.set(card.shotRef, card);
    if (card.shotNo) byShot.set(card.shotNo, card);
    byShot.set(formatShotNo(card.shotNo ?? card.shotRef, index), card);
  });
  return byShot;
}

function resolveSlotTimelineBlocks(
  slots: NonNullable<NonNullable<AnalysisHistoryItem["artifact"]>["functionSlotAtomizationAnalysis"]>["slotMap"]["slots"],
  shots: NonNullable<NonNullable<AnalysisHistoryItem["artifact"]>["shotBoundaryAnalysis"]>["shots"],
): AnalysisTimelineBlock[] {
  const shotByRef = new Map<string, { label: string; start: number; end: number }>();
  shots.forEach((shot) => {
    const value = { label: formatShotNo(shot.shotNo, shot.index), start: shot.start, end: shot.end };
    shotByRef.set(shot.id, value);
    if (shot.shotNo) shotByRef.set(shot.shotNo, value);
    shotByRef.set(value.label, value);
    shotByRef.set(String(shot.index + 1), value);
  });

  return slots.map((slot, index) => {
    const ranges = slot.sourceRefs.shotRefs
      .map((ref) => shotByRef.get(ref))
      .filter((range): range is { label: string; start: number; end: number } => Boolean(range));
    const start = ranges.length ? Math.min(...ranges.map((range) => range.start)) : index;
    const end = ranges.length ? Math.max(...ranges.map((range) => range.end)) : index + 1;
    const duration = Math.max(end - start, 0);
    const shotBoundaryPercents = ranges
      .sort((a, b) => a.start - b.start)
      .slice(1)
      .map((range) => duration ? clampTimelinePercent(((range.start - start) / duration) * 100) : 0)
      .filter((left) => left > 0 && left < 100);
    const shotRangeLabel = ranges.length ? formatShotRangeLabel(ranges.map((range) => range.label)) : formatShotRangeLabel(slot.sourceRefs.shotRefs);

    return {
      id: slot.slotId,
      label: slot.slotName,
      start,
      end,
      shotBoundaryPercents,
      shotRangeLabel,
      detail: {
        id: `slot:${slot.slotId}`,
        tone: "slot",
        title: slot.slotName,
        timeLabel: `${formatTimelineTime(start)} - ${formatTimelineTime(end)}`,
        shotRangeLabel,
        summary: slot.persuasionTask || slot.slotType || "这个槽位还没有摘要。",
        fields: compactTimelineDetailFields([
          { label: "槽位类型", value: slot.slotType },
          { label: "说服任务", value: slot.persuasionTask },
          { label: "观众状态前", value: slot.viewerStateBefore },
          { label: "观众状态后", value: slot.viewerStateAfter },
          { label: "同步点", value: slot.requiredSyncPoints.join(" / ") },
          { label: "替换规则", value: slot.substitutionRules.join(" / ") },
        ]),
      },
    };
  });
}

function withStructureDetailMeta({
  id,
  tone,
  label,
  start,
  end,
  shotRefs,
  shotMeta,
  summary,
  fields,
}: {
  id: string;
  tone: "script" | "rhythm" | "packaging";
  label: string;
  start: number;
  end: number;
  shotRefs: string[];
  shotMeta: Map<string, { index: number; label: string; start: number; end: number }>;
  summary: string;
  fields: Array<{ label: string; value: string }>;
}) {
  const shotRange = resolveStructureBlockShotMeta(shotRefs, shotMeta);
  return {
    ...shotRange,
    detail: {
      id: `${tone}:${id}`,
      tone,
      title: label,
      timeLabel: `${formatTimelineTime(start)} - ${formatTimelineTime(end)}`,
      shotRangeLabel: shotRange.shotRangeLabel,
      summary: timelineDetailText(summary),
      fields: compactTimelineDetailFields(fields),
    },
  };
}

function compactTimelineDetailFields(fields: Array<{ label: string; value: string | null | undefined }>) {
  return fields
    .map((field) => ({
      label: field.label,
      value: timelineDetailText(field.value),
    }))
    .filter((field) => field.value);
}

function timelineDetailText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function fieldPreview(fields: Array<{ label: string; value: string }> | null | undefined) {
  return fields?.map((field) => field.value).filter(Boolean).slice(0, 2).join(" / ") ?? "";
}

function formatShotRangeLabel(shotRefs: string[]) {
  const labels = shotRefs.map((ref, index) => formatShotNo(ref, index)).filter(Boolean);
  if (!labels.length) return null;
  return labels[0] === labels[labels.length - 1] ? labels[0] : `${labels[0]}-${labels[labels.length - 1]}`;
}

function timelineBlockStyle(block: AnalysisTimelineBlock, duration: number): CSSProperties {
  const start = clampTimelinePercent((block.start / duration) * 100);
  const end = clampTimelinePercent((block.end / duration) * 100);
  const adjustedEnd = Math.max(start + 0.5, end);
  return {
    left: `calc(${start}% + var(--new-ui-analysis-block-gap) / 2)`,
    right: `calc(${100 - adjustedEnd}% + var(--new-ui-analysis-block-gap) / 2)`,
  };
}

function buildShotTimelineMeta(shots: NonNullable<NonNullable<AnalysisHistoryItem["artifact"]>["shotBoundaryAnalysis"]>["shots"]) {
  const byRef = new Map<string, { index: number; label: string; start: number; end: number }>();
  shots.forEach((shot) => {
    const label = formatShotNo(shot.shotNo, shot.index);
    const value = { index: shot.index, label, start: shot.start, end: shot.end };
    byRef.set(shot.id, value);
    byRef.set(label, value);
    if (shot.shotNo) byRef.set(shot.shotNo, value);
    byRef.set(String(shot.index + 1), value);
  });
  return byRef;
}

function resolveStructureBlockShotMeta(
  shotRefs: string[],
  shotMeta: Map<string, { index: number; label: string; start: number; end: number }>,
) {
  const shots = shotRefs
    .map((ref) => shotMeta.get(ref) ?? shotMeta.get(formatShotNo(ref, 0)))
    .filter((shot): shot is { index: number; label: string; start: number; end: number } => Boolean(shot))
    .sort((a, b) => a.index - b.index);
  if (!shots.length) return { shotBoundaryPercents: [], shotRangeLabel: null };

  const start = Math.min(...shots.map((shot) => shot.start));
  const end = Math.max(...shots.map((shot) => shot.end));
  const duration = Math.max(end - start, 0);
  const internalBoundaries = shots
    .slice(1)
    .map((shot) => duration ? clampTimelinePercent(((shot.start - start) / duration) * 100) : 0)
    .filter((left) => left > 0 && left < 100);
  const first = shots[0].label;
  const last = shots[shots.length - 1].label;
  return {
    shotBoundaryPercents: internalBoundaries,
    shotRangeLabel: first === last ? first : `${first}-${last}`,
  };
}

function resolveShotFrameUrls(start: number, end: number, frames: NonNullable<AnalysisHistoryItem["artifact"]>["frames"]) {
  const startTime = positiveTimelineNumber(start);
  const endTime = positiveTimelineNumber(end);
  const matched = frames
    .filter((frame) => {
      const timestamp = Number(frame.timestamp);
      if (!Number.isFinite(timestamp)) return false;
      return timestamp >= startTime && (timestamp < endTime || Math.abs(timestamp - endTime) < 0.001);
    })
    .map((frame) => runtimeUrl(frame.imageUri))
    .filter((url): url is string => Boolean(url));

  if (matched.length) return sampleShotFrameUrls(matched, 6);

  const middle = startTime + Math.max(0, endTime - startTime) / 2;
  let closest: { url: string; distance: number } | null = null;
  for (const frame of frames) {
    const timestamp = Number(frame.timestamp);
    const url = runtimeUrl(frame.imageUri);
    if (!Number.isFinite(timestamp) || !url) continue;
    const distance = Math.abs(timestamp - middle);
    if (!closest || distance < closest.distance) closest = { url, distance };
  }
  return closest ? [closest.url] : [];
}

function sampleShotFrameUrls(urls: string[], maxCount: number) {
  if (urls.length <= maxCount) return urls;
  if (maxCount <= 1) return [urls[Math.floor(urls.length / 2)]];
  return Array.from({ length: maxCount }, (_item, index) => urls[Math.round((index / (maxCount - 1)) * (urls.length - 1))]);
}

function formatShotNo(value: string | null | undefined, index: number) {
  const text = String(value ?? "").trim();
  const shotNoMatch = /^S(\d+)$/i.exec(text);
  if (shotNoMatch) return `S${String(Number(shotNoMatch[1])).padStart(2, "0")}`;
  return `S${String(index + 1).padStart(2, "0")}`;
}

function formatShotLabel(value: string) {
  return formatShotNo(value, 0);
}

function timelineTickStyle(tick: number, duration: number): CSSProperties {
  return {
    left: `${clampTimelinePercent((tick / duration) * 100)}%`,
  };
}

function timelineTimePercent(time: number, duration: number) {
  return clampTimelinePercent((positiveTimelineNumber(time) / duration) * 100);
}

function resolveTimelinePointerTimeFromScale(element: HTMLElement, clientX: number, duration: number) {
  const rect = element.getBoundingClientRect();
  if (!rect.width) return 0;
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return duration * ratio;
}

function maxTimelineEnd(blocks: AnalysisTimelineBlock[]) {
  return blocks.reduce((max, block) => Math.max(max, positiveTimelineNumber(block.end)), 0);
}

function positiveTimelineNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function clampTimelinePercent(value: number) {
  return Math.min(100, Math.max(0, value));
}

function resolveTimelineTicks(duration: number) {
  const end = Math.max(5, Math.ceil(duration / 5) * 5);
  const ticks: number[] = [];
  for (let second = 0; second <= end; second += 5) {
    ticks.push(second);
  }
  return ticks;
}

function formatTimelineTime(value: number) {
  return formatSecondsCompact(value);
}

function formatTimelineTick(value: number) {
  return `${Math.max(0, Math.round(value))}s`;
}
