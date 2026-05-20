(function () {
  const MIN_TIMELINE_WIDTH = 720;
  const DEFAULT_VIEWPORT_WIDTH = 900;
  const FRAME_CELL_WIDTH = 76;
  const MAX_RENDERED_FRAMES = 80;

  function createTimelineMetrics(video, options = {}) {
    const duration = Math.max(1, video?.duration ?? 0);
    const visibleSeconds = clampVisibleSeconds(options.visibleSeconds);
    const viewportWidth = Math.max(MIN_TIMELINE_WIDTH, options.viewportWidth || DEFAULT_VIEWPORT_WIDTH);
    const pixelsPerSecond = viewportWidth / visibleSeconds;
    const contentWidth = Math.max(MIN_TIMELINE_WIDTH, Math.ceil(duration * pixelsPerSecond));
    const tickStep = chooseTickStep(duration);
    const ticks = [];
    for (let time = 0; time <= duration; time += tickStep) {
      ticks.push({ time, left: timelineLeft(time, { duration, contentWidth }) });
    }
    if (shouldAppendEndTick(ticks, duration)) ticks.push({ time: duration, left: contentWidth });
    return { duration, contentWidth, pixelsPerSecond, visibleSeconds, ticks };
  }

  function visibleFrames(frames) {
    if (frames.length <= MAX_RENDERED_FRAMES) return frames;
    const step = (frames.length - 1) / (MAX_RENDERED_FRAMES - 1);
    return Array.from({ length: MAX_RENDERED_FRAMES }, (_, index) => frames[Math.round(index * step)]);
  }

  function frameLeft(time, metrics) {
    return Math.min(metrics.contentWidth - FRAME_CELL_WIDTH, timelineLeft(time, metrics));
  }

  function timelineLeft(time, metrics) {
    const ratio = Math.max(0, Math.min(1, (time || 0) / metrics.duration));
    return Math.round(metrics.contentWidth * ratio);
  }

  function chooseTickStep(duration) {
    if (duration <= 12) return 2;
    if (duration <= 30) return 5;
    if (duration <= 90) return 10;
    return 30;
  }

  function clampVisibleSeconds(value) {
    const next = Number(value);
    if (!Number.isFinite(next)) return 10;
    return Math.max(1, Math.min(30, next));
  }

  function shouldAppendEndTick(ticks, duration) {
    const last = ticks.at(-1);
    return !last || Math.floor(last.time) !== Math.floor(duration);
  }

  window.WorkbenchTimelineMetrics = { createTimelineMetrics, frameLeft, visibleFrames, clampVisibleSeconds };
})();
