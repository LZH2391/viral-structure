import { RefObject, useCallback, useEffect, useRef, type PointerEvent } from "react";
import { beginUiStage, emitUiStage } from "../observability/uiStage";
import { formatPreciseTime } from "../utils/format";
import { timelineLeftToTime, timeToTimelineLeft } from "../utils/timeline";
import type { TimelinePlaybackController } from "../hooks/useTimelinePlayback";

type TimelinePlayheadProps = {
  duration: number;
  contentWidth: number;
  disabled: boolean;
  mediaElement: HTMLMediaElement | null;
  uiTraceId: string;
  backendTraceId?: string | null;
  artifactId?: string | null;
  parentArtifactId?: string | null;
  scrollRef: RefObject<HTMLDivElement>;
  playheadRef: RefObject<HTMLDivElement>;
  labelRef: RefObject<HTMLSpanElement>;
  controller: TimelinePlaybackController;
};

const SCRUB_SEEK_INTERVAL_MS = 66;

export function TimelinePlayhead(props: TimelinePlayheadProps) {
  const {
    duration,
    contentWidth,
    disabled,
    mediaElement,
    uiTraceId,
    backendTraceId,
    artifactId,
    parentArtifactId,
    scrollRef,
    playheadRef,
    labelRef,
    controller,
  } = props;
  const draggingRef = useRef(false);
  const wasPlayingRef = useRef(false);
  const lastScrubSeekAtRef = useRef(0);
  const latestTimeRef = useRef(0);
  const scrubStartTimeRef = useRef(0);
  const suppressPlaybackEventRef = useRef(false);

  const applyTime = useCallback(
    (time: number) => {
      const nextTime = clampTime(time, duration);
      latestTimeRef.current = nextTime;
      const left = timeToTimelineLeft(nextTime, { duration, contentWidth });
      const root = playheadRef.current;
      if (root) root.style.transform = `translate3d(${left}px, 0, 0)`;
      if (labelRef.current) labelRef.current.textContent = formatPreciseTime(nextTime);
    },
    [contentWidth, duration, labelRef, playheadRef],
  );

  useEffect(() => {
    applyTime(controller.getCurrentTime());
  }, [applyTime, controller]);

  const emitPlaybackStage = useCallback(
    (stageName: "timeline.playback.toggle" | "timeline.playhead.seek" | "timeline.playhead.scrub", inputSummary: unknown, outputSummary: unknown) => {
      if (!uiTraceId) return;
      const stage = beginUiStage({
        uiTraceId,
        backendTraceId: backendTraceId ?? null,
        stageName,
        parentArtifactId: parentArtifactId ?? null,
        inputSummary,
      });
      emitUiStage(stage, "stage.start", { artifactId: artifactId ?? stage.artifactId });
      emitUiStage(stage, "stage.end", {
        artifactId: artifactId ?? stage.artifactId,
        parentArtifactId: parentArtifactId ?? null,
        outputSummary,
      });
    },
    [artifactId, backendTraceId, parentArtifactId, uiTraceId],
  );

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const left = clientXToTimelineLeft(clientX, scrollRef.current, contentWidth);
      const time = timelineLeftToTime(left, { duration, contentWidth });
      controller.seekTo(time);
      applyTime(time);
      emitPlaybackStage("timeline.playhead.seek", { source: "ruler", targetTime: roundTime(time) }, { currentTime: roundTime(time) });
    },
    [applyTime, contentWidth, controller, duration, emitPlaybackStage, scrollRef],
  );

  const onRulerPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (disabled || event.button !== 0) return;
      seekFromClientX(event.clientX);
    },
    [disabled, seekFromClientX],
  );

  useEffect(() => {
    if (!mediaElement) return undefined;
    const onPlaybackChange = (event: Event) => {
      if (suppressPlaybackEventRef.current) {
        suppressPlaybackEventRef.current = false;
        return;
      }
      if (draggingRef.current) return;
      emitPlaybackStage("timeline.playback.toggle", { source: "media", event: event.type }, { playing: event.type === "play" });
    };
    mediaElement.addEventListener("play", onPlaybackChange);
    mediaElement.addEventListener("pause", onPlaybackChange);
    return () => {
      mediaElement.removeEventListener("play", onPlaybackChange);
      mediaElement.removeEventListener("pause", onPlaybackChange);
    };
  }, [emitPlaybackStage, mediaElement]);

  const onHandlePointerDown = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (disabled || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      draggingRef.current = true;
      lastScrubSeekAtRef.current = 0;
      scrubStartTimeRef.current = latestTimeRef.current;
      wasPlayingRef.current = Boolean(mediaElement && !mediaElement.paused && !mediaElement.ended);
      if (wasPlayingRef.current) {
        suppressPlaybackEventRef.current = true;
        mediaElement?.pause();
      }
    },
    [disabled, mediaElement],
  );

  const onHandlePointerMove = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (!draggingRef.current) return;
      const left = clientXToTimelineLeft(event.clientX, scrollRef.current, contentWidth);
      const time = timelineLeftToTime(left, { duration, contentWidth });
      applyTime(time);
      const now = performance.now();
      if (now - lastScrubSeekAtRef.current >= SCRUB_SEEK_INTERVAL_MS) {
        controller.seekTo(time);
        lastScrubSeekAtRef.current = now;
      }
    },
    [applyTime, contentWidth, controller, duration, scrollRef],
  );

  const finishScrub = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      event.currentTarget.releasePointerCapture(event.pointerId);
      const left = clientXToTimelineLeft(event.clientX, scrollRef.current, contentWidth);
      const time = timelineLeftToTime(left, { duration, contentWidth });
      controller.seekTo(time);
      applyTime(time);
      emitPlaybackStage("timeline.playhead.scrub", { fromTime: roundTime(scrubStartTimeRef.current), pausedForScrub: wasPlayingRef.current }, { currentTime: roundTime(time) });
      if (wasPlayingRef.current) {
        suppressPlaybackEventRef.current = true;
        void mediaElement?.play();
      }
      wasPlayingRef.current = false;
    },
    [applyTime, contentWidth, controller, duration, emitPlaybackStage, mediaElement, scrollRef],
  );

  return (
    <div className="timeline-playhead-hit-layer" aria-hidden={disabled ? "true" : undefined}>
      <div className="timeline-ruler-seek-zone" onPointerDown={onRulerPointerDown} />
      <div ref={playheadRef} className="timeline-playhead" data-timeline-playhead>
        <button
          className="timeline-playhead-handle"
          type="button"
          aria-label="播放头"
          disabled={disabled}
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={finishScrub}
          onPointerCancel={finishScrub}
        >
          <span ref={labelRef} className="timeline-playhead-time">
            00:00.00
          </span>
        </button>
        <span className="timeline-playhead-line" aria-hidden="true" />
      </div>
    </div>
  );
}

function clientXToTimelineLeft(clientX: number, scrollElement: HTMLDivElement | null, contentWidth: number): number {
  const rect = scrollElement?.getBoundingClientRect();
  if (!rect) return 0;
  const rawLeft = clientX - rect.left + (scrollElement?.scrollLeft ?? 0);
  return Math.max(0, Math.min(contentWidth, rawLeft));
}

function clampTime(time: number, duration: number): number {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
  if (!Number.isFinite(time) || safeDuration <= 0) return 0;
  return Math.max(0, Math.min(safeDuration, time));
}

function roundTime(time: number): number {
  return Math.round(time * 1000) / 1000;
}
