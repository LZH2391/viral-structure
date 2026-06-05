import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from "react";
import { runtimeUrl } from "../../api/client";
import { formatSecondsCompact } from "../../utils/format";
import type { AnalysisHistoryItem } from "./analysisHistoryData";

type AnalysisTimelineTrackTone = "shot" | "script" | "rhythm" | "packaging" | "slot";

type AnalysisTimelineBlock = {
  id: string;
  label: string;
  start: number;
  end: number;
  frameUrls?: string[];
  shotBoundaryPercents?: number[];
  shotRangeLabel?: string | null;
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

export function AnalysisTimelineTracks({ item, mediaKey, videoRef, onSeek }: { item: AnalysisHistoryItem | null; mediaKey: string; videoRef: RefObject<HTMLVideoElement>; onSeek: (time: number) => void }) {
  const timelineRef = useRef<HTMLElement>(null);
  const playheadScaleRef = useRef<HTMLDivElement>(null);
  const draggingPlayheadRef = useRef(false);
  const [draggingPlayhead, setDraggingPlayhead] = useState(false);
  const { duration, tracks } = resolveAnalysisTimelineTracks(item);
  const ticks = resolveTimelineTicks(duration);
  const shotCount = tracks.find((track) => track.key === "shot")?.blocks.length ?? 0;

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
    if (!timeline) return undefined;

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
  }, [duration, mediaKey, videoRef]);

  return (
    <section ref={timelineRef} className="new-ui-analysis-timeline" aria-label="分析轨道">
      <header className="new-ui-analysis-timeline-header">
        <h2>时间轴</h2>
        <span>{formatTimelineTime(duration)} · {shotCount} 镜头</span>
      </header>
      <div className="new-ui-analysis-timeline-body">
        <div className="new-ui-analysis-timeline-ruler" aria-hidden="true">
          <div className="new-ui-analysis-timeline-ruler-label">时间轨</div>
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
        <div className="new-ui-analysis-timeline-rows">
          {tracks.map((track) => (
            <div key={track.key} className={`new-ui-analysis-timeline-row is-${track.key}`}>
              <div className="new-ui-analysis-timeline-label">{track.label}</div>
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
                      <ShotTimelineBlock key={block.id} block={block} duration={duration} />
                    ) : track.key === "script" || track.key === "rhythm" || track.key === "packaging" ? (
                      <StructureTimelineBlock key={block.id} block={block} duration={duration} />
                    ) : (
                      <span
                        key={block.id}
                        className="new-ui-analysis-timeline-block"
                        style={timelineBlockStyle(block, duration)}
                        title={`${block.label} ${formatTimelineTime(block.start)}-${formatTimelineTime(block.end)}`}
                      >
                        {block.label}
                      </span>
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
              title="拖动调整播放位置"
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

function StructureTimelineBlock({ block, duration }: { block: AnalysisTimelineBlock; duration: number }) {
  return (
    <span
      className="new-ui-analysis-timeline-block new-ui-analysis-structure-block"
      style={timelineBlockStyle(block, duration)}
      title={`${block.label} ${formatTimelineTime(block.start)}-${formatTimelineTime(block.end)}${block.shotRangeLabel ? ` · ${block.shotRangeLabel}` : ""}`}
    >
      <span className="new-ui-analysis-structure-ticks" aria-hidden="true">
        {(block.shotBoundaryPercents ?? []).map((left, index) => (
          <span key={`${block.id}-tick-${index}-${left}`} className="new-ui-analysis-structure-tick" style={{ left: `${left}%` }} />
        ))}
      </span>
      <span className="new-ui-analysis-structure-label">{block.label}</span>
      {block.shotRangeLabel ? <span className="new-ui-analysis-structure-range">{block.shotRangeLabel}</span> : null}
    </span>
  );
}

function ShotTimelineBlock({ block, duration }: { block: AnalysisTimelineBlock; duration: number }) {
  const frameUrls = block.frameUrls ?? [];
  return (
    <span
      className={`new-ui-analysis-timeline-block new-ui-analysis-shot-block ${frameUrls.length ? "has-frames" : ""}`.trim()}
      style={timelineBlockStyle(block, duration)}
      title={`${block.label} ${formatTimelineTime(block.start)}-${formatTimelineTime(block.end)}`}
    >
      <span className="new-ui-analysis-shot-label">{formatShotLabel(block.label)}</span>
      {frameUrls.length ? (
        <span className="new-ui-analysis-shot-frames" aria-hidden="true">
          {frameUrls.map((url, index) => (
            <img key={`${block.id}-${index}-${url}`} className="new-ui-analysis-shot-frame" alt="" src={url} loading="lazy" />
          ))}
        </span>
      ) : null}
    </span>
  );
}

function hasVideoFrameCallback(video: HTMLVideoElement) {
  return typeof (video as Partial<VideoFrameCallbackVideo>).requestVideoFrameCallback === "function";
}

function resolveAnalysisTimelineTracks(item: AnalysisHistoryItem | null): { duration: number; tracks: AnalysisTimelineTrack[] } {
  const artifact = item?.artifact;
  const shots = artifact?.shotBoundaryAnalysis?.shots ?? [];
  const scriptSegments = artifact?.scriptSegmentAnalysis?.segments ?? [];
  const rhythmSections = artifact?.rhythmStructureAnalysis?.sections ?? [];
  const packagingBlocks = artifact?.packagingStructureAnalysis?.packagingBlocks ?? [];
  const slots = artifact?.functionSlotAtomizationAnalysis?.slotMap?.slots ?? [];
  const frames = artifact?.frames ?? [];
  const shotMeta = buildShotTimelineMeta(shots);
  const shotBlocks = shots.map((shot) => ({
    id: shot.id,
    label: formatShotNo(shot.shotNo, shot.index),
    start: shot.start,
    end: shot.end,
    frameUrls: resolveShotFrameUrls(shot.start, shot.end, frames),
  }));
  const scriptBlocks = scriptSegments.map((segment) => ({
    id: segment.segmentId,
    label: segment.label,
    start: segment.start,
    end: segment.end,
    ...resolveStructureBlockShotMeta(segment.shotRefs, shotMeta),
  }));
  const rhythmBlocks = rhythmSections.map((section) => ({
    id: section.sectionId,
    label: section.label,
    start: section.start,
    end: section.end,
    ...resolveStructureBlockShotMeta(section.shotRefs, shotMeta),
  }));
  const packagingTimelineBlocks = packagingBlocks.map((block) => ({
    id: block.blockId,
    label: block.label,
    start: block.start,
    end: block.end,
    ...resolveStructureBlockShotMeta(block.shotRefs, shotMeta),
  }));
  const slotBlocks = resolveSlotTimelineBlocks(slots, shots);
  const duration = Math.max(
    positiveTimelineNumber(artifact?.metadata.durationSeconds),
    maxTimelineEnd(shotBlocks),
    maxTimelineEnd(scriptBlocks),
    maxTimelineEnd(rhythmBlocks),
    maxTimelineEnd(packagingTimelineBlocks),
    maxTimelineEnd(slotBlocks),
    1,
  );

  return {
    duration,
    tracks: [
      { key: "shot", label: "镜头轨", emptyLabel: "暂无切镜", blocks: shotBlocks },
      { key: "script", label: "脚本段", emptyLabel: "暂无脚本段", blocks: scriptBlocks },
      { key: "rhythm", label: "节奏段", emptyLabel: "暂无节奏段", blocks: rhythmBlocks },
      { key: "packaging", label: "包装段", emptyLabel: "暂无包装段", blocks: packagingTimelineBlocks },
      { key: "slot", label: "槽位段", emptyLabel: "暂无槽位段", blocks: slotBlocks },
    ],
  };
}

function resolveSlotTimelineBlocks(
  slots: NonNullable<NonNullable<AnalysisHistoryItem["artifact"]>["functionSlotAtomizationAnalysis"]>["slotMap"]["slots"],
  shots: NonNullable<NonNullable<AnalysisHistoryItem["artifact"]>["shotBoundaryAnalysis"]>["shots"],
): AnalysisTimelineBlock[] {
  const shotByRef = new Map<string, { start: number; end: number }>();
  shots.forEach((shot) => {
    shotByRef.set(shot.id, shot);
    if (shot.shotNo) shotByRef.set(shot.shotNo, shot);
    shotByRef.set(String(shot.index + 1), shot);
  });

  return slots.map((slot, index) => {
    const ranges = slot.sourceRefs.shotRefs
      .map((ref) => shotByRef.get(ref))
      .filter((range): range is { start: number; end: number } => Boolean(range));
    const start = ranges.length ? Math.min(...ranges.map((range) => range.start)) : index;
    const end = ranges.length ? Math.max(...ranges.map((range) => range.end)) : index + 1;

    return {
      id: slot.slotId,
      label: slot.slotName,
      start,
      end,
    };
  });
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
