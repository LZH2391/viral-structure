const {
  MIN_SHOT_DURATION_SECONDS,
  ANALYSIS_SELECTION_POLICY,
  ANALYSIS_DUPLICATE_POLICY,
  normalizeBoundaryType,
  resolveRepresentativeFrameIdByTime,
  formatShotNo,
  clamp,
  roundNormalizedTime,
  invalidValidation,
  detectReasonEncodingIssue,
  summarizeAgentOutput,
  resolveShotSummary,
} = require("./shared");

function normalizeTimestampBoundaries(rawBoundaries) {
  if (!Array.isArray(rawBoundaries)) return [];
  return rawBoundaries.map((boundary) => ({
    timestamp: roundNormalizedTime(Number(boundary?.timestamp)),
    confidence: clamp(Number(boundary?.confidence ?? 0.5), 0, 1),
    boundaryType: normalizeBoundaryType(boundary?.boundaryType),
    reason: String(boundary?.reason ?? "视觉变化").slice(0, 160),
    needReview: Boolean(boundary?.needReview),
  }));
}

function validateTimestampBoundaries(boundaries, durationSeconds) {
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  if (!Array.isArray(boundaries)) {
    return invalidValidation("shot_boundary_missing_boundaries", "切镜 Agent 未返回 boundaries", {
      rawBoundaryCount: 0,
      normalizedBoundaryCount: 0,
      validatorCode: "shot_boundary_missing_boundaries",
    });
  }
  if (!boundaries.length) {
    return invalidValidation("shot_boundary_empty_boundaries", "切镜 Agent 未返回明确切镜边界", {
      rawBoundaryCount: 0,
      normalizedBoundaryCount: 0,
      validatorCode: "shot_boundary_empty_boundaries",
    });
  }
  let previousTimestamp = null;
  for (let index = 0; index < boundaries.length; index += 1) {
    const boundary = boundaries[index];
    if (!Number.isFinite(boundary.timestamp)) {
      return invalidValidation("shot_boundary_timestamp_invalid", "切镜时间点无效", {
        rawBoundaryCount: boundaries.length,
        normalizedBoundaryCount: boundaries.length,
        validatorCode: "shot_boundary_timestamp_invalid",
        failingIndex: index,
      });
    }
    if (boundary.timestamp <= 0 || (safeDuration > 0 && boundary.timestamp >= safeDuration)) {
      return invalidValidation("shot_boundary_timestamp_out_of_range", "切镜时间点超出允许范围", {
        rawBoundaryCount: boundaries.length,
        normalizedBoundaryCount: boundaries.length,
        validatorCode: "shot_boundary_timestamp_out_of_range",
        failingIndex: index,
        timestamp: boundary.timestamp,
        durationSeconds: safeDuration,
      });
    }
    if (previousTimestamp !== null && boundary.timestamp <= previousTimestamp) {
      return invalidValidation("shot_boundary_timestamp_order_invalid", "切镜时间点重复或未按升序排列", {
        rawBoundaryCount: boundaries.length,
        normalizedBoundaryCount: boundaries.length,
        validatorCode: "shot_boundary_timestamp_order_invalid",
        failingIndex: index,
        timestamp: boundary.timestamp,
        previousTimestamp,
      });
    }
    previousTimestamp = boundary.timestamp;
  }
  return {
    ok: true,
    summary: {
      rawBoundaryCount: boundaries.length,
      normalizedBoundaryCount: boundaries.length,
      validatorCode: null,
    },
  };
}

function buildShotsFromBoundaries(boundaries, frames, durationSeconds, parsedShots = []) {
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 1;
  const safeParsedShots = Array.isArray(parsedShots) ? parsedShots : [];
  const normalizedFrames = Array.isArray(frames)
    ? frames
      .map((frame) => ({
        frameId: frame.frameId,
        timestamp: Number(frame.timestamp ?? 0),
        inputIndex: Number(frame.inputIndex ?? 0),
      }))
      .filter((frame) => frame.frameId)
      .sort((first, second) => first.inputIndex - second.inputIndex)
    : [];
  const shots = [];
  let start = 0;
  for (const boundary of boundaries) {
    const end = clamp(boundary.timestamp, shots.length ? shots[shots.length - 1].end + MIN_SHOT_DURATION_SECONDS : MIN_SHOT_DURATION_SECONDS, safeDuration);
    shots.push({
      id: `shot_${shots.length + 1}`,
      index: shots.length,
      shotNo: formatShotNo(shots.length),
      start: roundNormalizedTime(start),
      end: roundNormalizedTime(end),
      representativeFrameId: resolveRepresentativeFrameIdByTime(normalizedFrames, start, end),
      confidence: boundary.confidence,
      reason: boundary.reason,
      summary: resolveShotSummary(safeParsedShots[shots.length]?.summary, boundary.reason),
      endBoundaryReason: boundary.reason,
    });
    start = end;
  }
  shots.push({
    id: `shot_${shots.length + 1}`,
    index: shots.length,
    shotNo: formatShotNo(shots.length),
    start: roundNormalizedTime(start),
    end: roundNormalizedTime(safeDuration),
    representativeFrameId: resolveRepresentativeFrameIdByTime(normalizedFrames, start, safeDuration),
    confidence: boundaries.at(-1)?.confidence ?? 0.5,
    reason: boundaries.at(-1)?.reason ?? "视觉连续",
    summary: resolveShotSummary(safeParsedShots[shots.length]?.summary, boundaries.at(-1)?.reason ?? "视觉连续"),
    endBoundaryReason: null,
  });
  return shots
    .filter((shot) => shot.end > shot.start && shot.representativeFrameId)
    .map((shot, index) => ({ ...shot, index, shotNo: formatShotNo(index) }));
}

module.exports = {
  normalizeTimestampBoundaries,
  validateTimestampBoundaries,
  buildShotsFromBoundaries,
  detectReasonEncodingIssue,
  summarizeAgentOutput,
};
