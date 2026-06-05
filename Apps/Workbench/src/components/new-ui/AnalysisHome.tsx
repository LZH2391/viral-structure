import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from "react";
import { formatSecondsCompact } from "../../utils/format";
import { AnalysisHistory } from "./AnalysisHistory";
import { resolveAnalysisHistoryMedia, type AnalysisHistoryItem, type AnalysisHistoryMedia } from "./analysisHistoryData";
import type { AnalysisDetailSidebarState } from "./AnalysisWorkflowSidebar";

type AnalysisHomeProps = {
  onDetailStateChange?: (state: AnalysisDetailSidebarState) => void;
};

export function AnalysisHome({ onDetailStateChange }: AnalysisHomeProps = {}) {
  const [view, setView] = useState<"home" | "detail">("home");
  const [detailTitle, setDetailTitle] = useState("新建分析");
  const [detailMedia, setDetailMedia] = useState<AnalysisHistoryMedia | null>(null);
  const [detailItem, setDetailItem] = useState<AnalysisHistoryItem | null>(null);

  const openUploadDetail = () => {
    setDetailTitle("新建分析");
    setDetailMedia(null);
    setDetailItem(null);
    setView("detail");
  };

  const openHistoryDetail = (item: AnalysisHistoryItem) => {
    const media = resolveAnalysisHistoryMedia(item);
    setDetailTitle(media.title);
    setDetailMedia(media);
    setDetailItem(item);
    setView("detail");
  };

  useEffect(() => {
    onDetailStateChange?.({
      visible: view === "detail",
      title: detailTitle,
      item: detailItem,
    });
  }, [detailItem, detailTitle, onDetailStateChange, view]);

  return (
    <>
      <section className={`new-ui-analysis-home ${view === "home" ? "" : "is-hidden"}`.trim()} aria-hidden={view !== "home"} aria-label="分析首页">
        <button className="new-ui-analysis-upload-frame" type="button" aria-label="上传视频开始分析" onClick={openUploadDetail}>
          <span className="new-ui-analysis-upload-icon-tile">
            <svg className="new-ui-analysis-upload-icon" viewBox="0 0 128 96" focusable="false" aria-hidden="true">
              <path className="new-ui-analysis-upload-cloud-fill" d="M38 70c-10.6 0-19-8.2-19-18.5 0-9.8 7.3-17.6 17.1-19.1 3.6-10.9 13.1-17.9 24.4-17.9 12.6 0 23 9 25.1 20.9 10.1 1.3 17.9 9 17.9 18.8 0 8.9-6.7 15.8-16.1 15.8H38Z" />
              <path className="new-ui-analysis-upload-cloud-line" d="M38 70c-10.6 0-19-8.2-19-18.5 0-9.8 7.3-17.6 17.1-19.1 3.6-10.9 13.1-17.9 24.4-17.9 12.6 0 23 9 25.1 20.9 10.1 1.3 17.9 9 17.9 18.8 0 8.9-6.7 15.8-16.1 15.8H38Z" />
              <path className="new-ui-analysis-upload-arrow" d="M61 71V42" />
              <path className="new-ui-analysis-upload-arrow" d="M46 56 61 41l15 15" />
              <path className="new-ui-analysis-upload-base" d="M49 82h24" />
            </svg>
          </span>
          <span className="new-ui-analysis-upload-copy">
            <span className="new-ui-analysis-upload-primary">拖拽视频到此处</span>
            <span className="new-ui-analysis-upload-secondary">或点击选择文件</span>
          </span>
          <span className="new-ui-analysis-upload-limit" aria-hidden="true">MP4/MOV 最多 5 个 最大 2GB</span>
        </button>
        <AnalysisHistory onOpenItem={openHistoryDetail} />
      </section>
      <AnalysisDetailPage hidden={view !== "detail"} title={detailTitle} media={detailMedia} item={detailItem} onBack={() => setView("home")} />
    </>
  );
}

function AnalysisDetailPage({
  hidden,
  title,
  media,
  item,
  onBack,
}: {
  hidden: boolean;
  title: string;
  media: AnalysisHistoryMedia | null;
  item: AnalysisHistoryItem | null;
  onBack: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const orientation = media?.orientation ?? "landscape";

  useEffect(() => {
    if (hidden) {
      videoRef.current?.pause();
    }
  }, [hidden]);

  const seekTimeline = (time: number) => {
    const nextTime = Math.max(0, time);
    const video = videoRef.current;
    if (video) {
      video.currentTime = Math.min(nextTime, Number.isFinite(video.duration) ? video.duration : nextTime);
      return;
    }
  };

  return (
    <section className={`new-ui-analysis-detail ${hidden ? "is-hidden" : ""}`.trim()} aria-hidden={hidden} aria-label="分析详情">
      <header className="new-ui-analysis-detail-header">
        <button className="new-ui-analysis-title-button" type="button" aria-label={`返回分析首页：${title}`} title={title} onClick={onBack}>
          <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <path d="M15 6 9 12l6 6" />
          </svg>
          <span className="new-ui-analysis-detail-title">{title}</span>
        </button>
      </header>
      <div className="new-ui-analysis-detail-body">
        <div className="new-ui-analysis-detail-media">
          <div className={`new-ui-analysis-player is-${orientation}`}>
            {media?.videoUrl ? (
              <video
                ref={videoRef}
                key={media.videoUrl}
                src={media.videoUrl}
                poster={media.coverUrl ?? undefined}
                controls
                playsInline
                preload="metadata"
              />
            ) : (
              <div className="new-ui-analysis-player-empty" aria-hidden="true" />
            )}
          </div>
        </div>
        <AnalysisTimelineTracks item={item} mediaKey={media?.videoUrl ?? item?.sample.resourceId ?? "empty"} videoRef={videoRef} onSeek={seekTimeline} />
      </div>
    </section>
  );
}

type AnalysisTimelineTrackTone = "shot" | "script" | "rhythm" | "packaging" | "atom";

type AnalysisTimelineBlock = {
  id: string;
  label: string;
  start: number;
  end: number;
};

type AnalysisTimelineTrack = {
  key: AnalysisTimelineTrackTone;
  label: string;
  emptyLabel: string;
  blocks: AnalysisTimelineBlock[];
};

type VideoFrameCallbackVideo = HTMLVideoElement & {
  requestVideoFrameCallback: (callback: (now: number, metadata: { mediaTime: number }) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

function AnalysisTimelineTracks({ item, mediaKey, videoRef, onSeek }: { item: AnalysisHistoryItem | null; mediaKey: string; videoRef: RefObject<HTMLVideoElement>; onSeek: (time: number) => void }) {
  const timelineRef = useRef<HTMLElement>(null);
  const playheadScaleRef = useRef<HTMLDivElement>(null);
  const draggingPlayheadRef = useRef(false);
  const [draggingPlayhead, setDraggingPlayhead] = useState(false);
  const { duration, tracks } = resolveAnalysisTimelineTracks(item);
  const ticks = resolveTimelineTicks(duration);
  const shotCount = tracks.find((track) => track.key === "shot")?.blocks.length ?? 0;

  const seekFromLane = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const time = resolveTimelinePointerTime(event, duration);
    onSeek(time);
  };

  const seekFromPlayheadClientX = (clientX: number) => {
    const scale = playheadScaleRef.current;
    if (!scale) return;
    const time = resolveTimelinePointerTimeFromScale(scale, clientX, duration);
    timelineRef.current?.style.setProperty("--new-ui-analysis-nav-left", `${timelineTimePercent(time, duration)}%`);
    onSeek(time);
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
        frameHandle = video.requestVideoFrameCallback((_now, metadata) => {
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
      if (frameHandle && hasVideoFrameCallback(video)) video.cancelVideoFrameCallback?.(frameHandle);
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
          <div className="new-ui-analysis-timeline-ruler-lane" onPointerDown={seekFromLane}>
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
              <div className="new-ui-analysis-timeline-lane" onPointerDown={seekFromLane}>
                <div className="new-ui-analysis-timeline-lane-scale">
                  {track.blocks.map((block) => (
                    <span
                      key={block.id}
                      className="new-ui-analysis-timeline-block"
                      style={timelineBlockStyle(block, duration)}
                      title={`${block.label} ${formatTimelineTime(block.start)}-${formatTimelineTime(block.end)}`}
                    >
                      {block.label}
                    </span>
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

function hasVideoFrameCallback(video: HTMLVideoElement): video is VideoFrameCallbackVideo {
  return typeof (video as Partial<VideoFrameCallbackVideo>).requestVideoFrameCallback === "function";
}

function resolveAnalysisTimelineTracks(item: AnalysisHistoryItem | null): { duration: number; tracks: AnalysisTimelineTrack[] } {
  const artifact = item?.artifact;
  const shots = artifact?.shotBoundaryAnalysis?.shots ?? [];
  const scriptSegments = artifact?.scriptSegmentAnalysis?.segments ?? [];
  const rhythmSections = artifact?.rhythmStructureAnalysis?.sections ?? [];
  const packagingBlocks = artifact?.packagingStructureAnalysis?.packagingBlocks ?? [];
  const atomSlots = artifact?.functionSlotAtomizationAnalysis?.slotMap?.slots ?? [];
  const shotBlocks = shots.map((shot) => ({
    id: shot.id,
    label: shot.shotNo ?? `镜头 ${shot.index + 1}`,
    start: shot.start,
    end: shot.end,
  }));
  const scriptBlocks = scriptSegments.map((segment) => ({
    id: segment.segmentId,
    label: segment.label,
    start: segment.start,
    end: segment.end,
  }));
  const rhythmBlocks = rhythmSections.map((section) => ({
    id: section.sectionId,
    label: section.label,
    start: section.start,
    end: section.end,
  }));
  const packagingTimelineBlocks = packagingBlocks.map((block) => ({
    id: block.blockId,
    label: block.label,
    start: block.start,
    end: block.end,
  }));
  const atomBlocks = resolveAtomTimelineBlocks(atomSlots, shots);
  const duration = Math.max(
    positiveTimelineNumber(artifact?.metadata.durationSeconds),
    maxTimelineEnd(shotBlocks),
    maxTimelineEnd(scriptBlocks),
    maxTimelineEnd(rhythmBlocks),
    maxTimelineEnd(packagingTimelineBlocks),
    maxTimelineEnd(atomBlocks),
    1,
  );

  return {
    duration,
    tracks: [
      { key: "shot", label: "镜头轨", emptyLabel: "暂无切镜", blocks: shotBlocks },
      { key: "script", label: "脚本段", emptyLabel: "暂无脚本段", blocks: scriptBlocks },
      { key: "rhythm", label: "节奏段", emptyLabel: "暂无节奏段", blocks: rhythmBlocks },
      { key: "packaging", label: "包装段", emptyLabel: "暂无包装段", blocks: packagingTimelineBlocks },
      { key: "atom", label: "原子段", emptyLabel: "暂无原子段", blocks: atomBlocks },
    ],
  };
}

function resolveAtomTimelineBlocks(
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

function timelineTickStyle(tick: number, duration: number): CSSProperties {
  return {
    left: `${clampTimelinePercent((tick / duration) * 100)}%`,
  };
}

function timelineTimePercent(time: number, duration: number) {
  return clampTimelinePercent((positiveTimelineNumber(time) / duration) * 100);
}

function resolveTimelinePointerTime(event: PointerEvent<HTMLElement>, duration: number) {
  const rect = event.currentTarget.getBoundingClientRect();
  if (!rect.width) return 0;
  const laneEdgeGap = parseCssPixelValue(window.getComputedStyle(event.currentTarget).getPropertyValue("--new-ui-analysis-lane-edge-gap"));
  const scaleWidth = Math.max(1, rect.width - laneEdgeGap * 2);
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left - laneEdgeGap) / scaleWidth));
  return duration * ratio;
}

function resolveTimelinePointerTimeFromScale(element: HTMLElement, clientX: number, duration: number) {
  const rect = element.getBoundingClientRect();
  if (!rect.width) return 0;
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return duration * ratio;
}

function parseCssPixelValue(value: string) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : 0;
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
