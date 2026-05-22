function planFrameTimestamps(durationSeconds, options = {}) {
  return planFrameTimestampSampling(durationSeconds, options).timestamps;
}

function planFrameTimestampSampling(durationSeconds, options = {}) {
  const frameSampleRateFps = Number(options.frameSampleRateFps ?? 1);
  const maxFrames = Number(options.maxFrames ?? 6000);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return buildSamplingResult([0], frameSampleRateFps, maxFrames, false, "fixed_interval_from_zero");
  }
  if (!Number.isFinite(frameSampleRateFps) || frameSampleRateFps <= 0) {
    return buildSamplingResult([0], frameSampleRateFps, maxFrames, false, "fixed_interval_from_zero");
  }
  const safeMaxFrames = Number.isFinite(maxFrames) && maxFrames > 0 ? Math.floor(maxFrames) : 6000;
  const step = 1 / frameSampleRateFps;
  const uncappedFrameCount = Math.max(1, Math.ceil(durationSeconds * frameSampleRateFps));
  if (uncappedFrameCount > safeMaxFrames) {
    return buildSamplingResult(
      planCappedFullDurationGrid(durationSeconds, safeMaxFrames),
      frameSampleRateFps,
      safeMaxFrames,
      true,
      "capped_target_grid_cover_full_duration",
    );
  }
  const timestamps = [];
  for (let index = 0; index < uncappedFrameCount; index += 1) {
    const timestamp = index * step;
    if (timestamp >= durationSeconds) break;
    timestamps.push(Number(timestamp.toFixed(3)));
  }
  return buildSamplingResult(timestamps.length ? timestamps : [0], frameSampleRateFps, safeMaxFrames, false, "fixed_interval_from_zero");
}

function planCappedFullDurationGrid(durationSeconds, maxFrames) {
  const safeMaxFrames = Math.max(1, Math.floor(maxFrames));
  if (safeMaxFrames === 1) return [0];
  const lastTimestamp = Math.max(0, durationSeconds - 0.001);
  const step = lastTimestamp / (safeMaxFrames - 1);
  return Array.from({ length: safeMaxFrames }, (_, index) => Number((index * step).toFixed(3)));
}

function buildSamplingResult(timestamps, frameSampleRateFps, maxFrames, cappedByMaxFrames, samplingPolicy) {
  return {
    timestamps,
    frameSampleRateFps,
    targetFrameCount: timestamps.length,
    maxFrames: Number.isFinite(maxFrames) && maxFrames > 0 ? Math.floor(maxFrames) : 6000,
    samplingPolicy,
    cappedByMaxFrames,
  };
}

module.exports = { planFrameTimestamps, planFrameTimestampSampling };
