function planFrameTimestamps(durationSeconds, options = {}) {
  const maxFrames = options.maxFrames ?? 12;
  const minFrames = options.minFrames ?? 4;
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [0];
  const count = Math.min(maxFrames, Math.max(minFrames, Math.ceil(durationSeconds / 4)));
  if (count === 1) return [0];
  return Array.from({ length: count }, (_, index) => {
    const raw = (durationSeconds * index) / (count - 1);
    return Number(Math.min(raw, Math.max(durationSeconds - 0.1, 0)).toFixed(3));
  });
}

module.exports = { planFrameTimestamps };
