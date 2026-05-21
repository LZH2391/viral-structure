import type { SampleFrame, SampleVideo } from "../types";

const MIN_TIMELINE_WIDTH = 720;
const DEFAULT_VIEWPORT_WIDTH = 900;
const FRAME_CELL_WIDTH = 76;
export const MAX_RENDERED_FRAMES = 80;

export type TimelineMetrics = {
  duration: number;
  contentWidth: number;
  pixelsPerSecond: number;
  visibleSeconds: number;
  ticks: Array<{ time: number; left: number }>;
};

export function createTimelineMetrics(video: SampleVideo | null, options: { visibleSeconds?: number; viewportWidth?: number } = {}): TimelineMetrics {
  const duration = Math.max(1, video?.duration ?? 0);
  const visibleSeconds = clampVisibleSeconds(options.visibleSeconds);
  const viewportWidth = Math.max(MIN_TIMELINE_WIDTH, options.viewportWidth || DEFAULT_VIEWPORT_WIDTH);
  const pixelsPerSecond = viewportWidth / visibleSeconds;
  const contentWidth = Math.max(MIN_TIMELINE_WIDTH, Math.ceil(duration * pixelsPerSecond));
  const tickStep = chooseTickStep(duration);
  const ticks = [];
  for (let time = 0; time <= duration; time += tickStep) {
    ticks.push({ time, left: timeToTimelineLeft(time, { duration, contentWidth }) });
  }
  if (shouldAppendEndTick(ticks, duration)) ticks.push({ time: duration, left: contentWidth });
  return { duration, contentWidth, pixelsPerSecond, visibleSeconds, ticks };
}

export function visibleFrames(frames: SampleFrame[]): SampleFrame[] {
  if (frames.length <= MAX_RENDERED_FRAMES) return frames;
  const step = (frames.length - 1) / (MAX_RENDERED_FRAMES - 1);
  return Array.from({ length: MAX_RENDERED_FRAMES }, (_, index) => frames[Math.round(index * step)]);
}

export function frameLeft(time: number, metrics: Pick<TimelineMetrics, "duration" | "contentWidth">): number {
  return Math.min(metrics.contentWidth - FRAME_CELL_WIDTH, timeToTimelineLeft(time, metrics));
}

export function clampVisibleSeconds(value: unknown): number {
  const next = Number(value);
  if (!Number.isFinite(next)) return 10;
  return Math.max(1, Math.min(30, next));
}

export function timeToTimelineLeft(time: number, metrics: Pick<TimelineMetrics, "duration" | "contentWidth">): number {
  const duration = safePositiveNumber(metrics.duration);
  const contentWidth = safePositiveNumber(metrics.contentWidth);
  if (!duration || !contentWidth) return 0;
  const safeTime = Number.isFinite(time) ? time : 0;
  const ratio = Math.max(0, Math.min(1, safeTime / duration));
  return Math.round(contentWidth * ratio);
}

export function timelineLeftToTime(left: number, metrics: Pick<TimelineMetrics, "duration" | "contentWidth">): number {
  const duration = safePositiveNumber(metrics.duration);
  const contentWidth = safePositiveNumber(metrics.contentWidth);
  if (!duration || !contentWidth) return 0;
  const safeLeft = Number.isFinite(left) ? left : 0;
  const ratio = Math.max(0, Math.min(1, safeLeft / contentWidth));
  return duration * ratio;
}

function safePositiveNumber(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function chooseTickStep(duration: number): number {
  if (duration <= 12) return 2;
  if (duration <= 30) return 5;
  if (duration <= 90) return 10;
  return 30;
}

function shouldAppendEndTick(ticks: Array<{ time: number }>, duration: number): boolean {
  const last = ticks[ticks.length - 1];
  return !last || Math.floor(last.time) !== Math.floor(duration);
}
