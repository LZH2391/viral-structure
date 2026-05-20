function planFrameTimestamps(durationSeconds, options = {}) {
  const frameSampleRateFps = options.frameSampleRateFps ?? 0.25;
  const maxFrames = options.maxFrames ?? 120;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [0];
  const targetFrames = Math.max(1, Math.ceil(durationSeconds * frameSampleRateFps));
  const count = Math.min(maxFrames, targetFrames);
  if (count === 1) return [0];
  return Array.from({ length: count }, (_, index) => {
    const raw = (durationSeconds * index) / (count - 1);
    return Number(Math.min(raw, Math.max(durationSeconds - 0.1, 0)).toFixed(3));
  });
}

module.exports = { planFrameTimestamps };
