(function () {
  const PIXELS_PER_SECOND = 90;
  const MIN_TIMELINE_WIDTH = 720;
  const FRAME_CELL_WIDTH = 76;

  function createTimelineMetrics(video) {
    const duration = Math.max(1, video?.duration ?? 0);
    const contentWidth = Math.max(MIN_TIMELINE_WIDTH, Math.ceil(duration * PIXELS_PER_SECOND));
    const tickStep = chooseTickStep(duration);
    const ticks = [];
    for (let time = 0; time <= duration; time += tickStep) {
      ticks.push({ time, left: timelineLeft(time, { duration, contentWidth }) });
    }
    if (ticks.at(-1)?.time !== duration) ticks.push({ time: duration, left: contentWidth });
    return { duration, contentWidth, ticks };
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

  window.WorkbenchTimelineMetrics = { createTimelineMetrics, frameLeft };
})();
