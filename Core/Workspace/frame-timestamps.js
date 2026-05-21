function planFrameTimestamps(durationSeconds, options = {}) {
  const frameSampleRateFps = Number(options.frameSampleRateFps ?? 1);
  const maxFrames = Number(options.maxFrames ?? 120);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return [0];
  if (!Number.isFinite(frameSampleRateFps) || frameSampleRateFps <= 0) return [0];
  const safeMaxFrames = Number.isFinite(maxFrames) && maxFrames > 0 ? Math.floor(maxFrames) : 120;
  const step = 1 / frameSampleRateFps;
  const timestamps = [];
  for (let index = 0; index < safeMaxFrames; index += 1) {
    const timestamp = index * step;
    if (timestamp >= durationSeconds) break;
    timestamps.push(Number(timestamp.toFixed(3)));
  }
  return timestamps.length ? timestamps : [0];
}

module.exports = { planFrameTimestamps };
