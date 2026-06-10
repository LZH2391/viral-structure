import { useEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from "react";
import type { AnalysisHistoryItem } from "./analysisHistoryData";
import type { AnalysisTimelineSegmentDetail } from "./analysisTimelineSelection";
import { formatShotLabel, formatTimelineTick, formatTimelineTime, resolveAnalysisTimelineTracks, resolveTimelinePointerTimeFromScale, resolveTimelineTicks, timelineBlockStyle, timelineTickStyle, timelineTimePercent, type AnalysisTimelineBlock } from "./analysisTimelineTrackModel";

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
