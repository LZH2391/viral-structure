const {
  MIN_SHOT_DURATION_SECONDS,
  ANALYSIS_SELECTION_POLICY,
  ANALYSIS_DUPLICATE_POLICY,
  normalizeCommerceBrief,
  summarizeCommerceBrief,
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
    boundaryType: boundary?.boundaryType == null || boundary?.boundaryType === ""
      ? null
      : normalizeBoundaryType(boundary?.boundaryType),
    reason: normalizeBoundaryReason(boundary?.reason),
    needReview: Boolean(boundary?.needReview),
  }));
}

function normalizeShotCentricShots(rawShots) {
  if (!Array.isArray(rawShots)) return [];
  return rawShots.map((shot) => ({
    summary: resolveShotSummary(shot?.summary, ""),
    start: roundNormalizedTime(Number(shot?.start)),
    end: roundNormalizedTime(Number(shot?.end)),
    endBoundary: shot?.endBoundary && typeof shot.endBoundary === "object"
      ? {
        timestamp: roundNormalizedTime(Number(shot.endBoundary?.timestamp)),
        confidence: clamp(Number(shot.endBoundary?.confidence ?? 0.5), 0, 1),
        boundaryType: shot.endBoundary?.boundaryType == null || shot.endBoundary?.boundaryType === ""
          ? null
          : normalizeBoundaryType(shot.endBoundary?.boundaryType),
        reason: normalizeBoundaryReason(shot.endBoundary?.reason),
        needReview: Boolean(shot.endBoundary?.needReview),
      }
      : null,
  }));
}

function normalizeBoundaryReason(value) {
  if (value == null) return null;
  const normalized = String(value).replace(/\s+/g, " ").trim().slice(0, 160);
  return normalized || null;
}

function deriveBoundariesFromShots(rawShots) {
  return normalizeShotCentricShots(rawShots)
    .map((shot) => shot.endBoundary)
    .filter(Boolean);
}

function validateTimestampBoundaries(boundaries, durationSeconds, options = {}) {
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  if (options.allowEmpty) {
    return {
      ok: true,
      summary: {
        rawBoundaryCount: Array.isArray(boundaries) ? boundaries.length : 0,
        normalizedBoundaryCount: Array.isArray(boundaries) ? boundaries.length : 0,
        validatorCode: null,
      },
    };
  }
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

function validateShotCentricShots(rawShots, durationSeconds) {
  if (!Array.isArray(rawShots)) {
    return invalidValidation("shot_boundary_missing_shots", "切镜 Agent 未返回 shots", {
      rawBoundaryCount: 0,
      normalizedBoundaryCount: 0,
      validatorCode: "shot_boundary_missing_shots",
    });
  }
  if (!rawShots.length) {
    return invalidValidation("shot_boundary_empty_shots", "切镜 Agent 未返回明确镜头分段", {
      rawBoundaryCount: 0,
      normalizedBoundaryCount: 0,
      validatorCode: "shot_boundary_empty_shots",
    });
  }
  const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  const shots = normalizeShotCentricShots(rawShots);
  let previousEnd = null;
  for (let index = 0; index < shots.length; index += 1) {
    const shot = shots[index];
    const isLastShot = index === shots.length - 1;
    if (!Number.isFinite(shot.start) || !Number.isFinite(shot.end) || shot.end <= shot.start) {
      return invalidValidation("shot_boundary_shot_time_invalid", "shots 起止时间无效", {
        rawBoundaryCount: Math.max(0, shots.length - 1),
        normalizedBoundaryCount: Math.max(0, shots.length - 1),
        validatorCode: "shot_boundary_shot_time_invalid",
        failingIndex: index,
      });
    }
    if (index === 0 && shot.start !== 0) {
      return invalidValidation("shot_boundary_first_shot_start_invalid", "第一镜 start 必须为 0", {
        rawBoundaryCount: Math.max(0, shots.length - 1),
        normalizedBoundaryCount: Math.max(0, shots.length - 1),
        validatorCode: "shot_boundary_first_shot_start_invalid",
        failingIndex: index,
        start: shot.start,
      });
    }
    if (previousEnd !== null && shot.start !== previousEnd) {
      return invalidValidation("shot_boundary_shot_not_contiguous", "shots 未保持连续衔接", {
        rawBoundaryCount: Math.max(0, shots.length - 1),
        normalizedBoundaryCount: Math.max(0, shots.length - 1),
        validatorCode: "shot_boundary_shot_not_contiguous",
        failingIndex: index,
        start: shot.start,
        previousEnd,
      });
    }
    if (isLastShot) {
      if (shot.endBoundary !== null) {
        return invalidValidation("shot_boundary_last_end_boundary_invalid", "最后一镜 endBoundary 必须为 null", {
          rawBoundaryCount: Math.max(0, shots.length - 1),
          normalizedBoundaryCount: Math.max(0, shots.length - 1),
          validatorCode: "shot_boundary_last_end_boundary_invalid",
          failingIndex: index,
        });
      }
      if (safeDuration > 0 && shot.end !== roundNormalizedTime(safeDuration)) {
        return invalidValidation("shot_boundary_last_shot_end_invalid", "最后一镜 end 必须等于 durationSeconds", {
          rawBoundaryCount: Math.max(0, shots.length - 1),
          normalizedBoundaryCount: Math.max(0, shots.length - 1),
          validatorCode: "shot_boundary_last_shot_end_invalid",
          failingIndex: index,
          end: shot.end,
          durationSeconds: roundNormalizedTime(safeDuration),
        });
      }
    } else {
      if (!shot.endBoundary) {
        return invalidValidation("shot_boundary_missing_end_boundary", "除最后一镜外 endBoundary 不能为空", {
          rawBoundaryCount: Math.max(0, shots.length - 1),
          normalizedBoundaryCount: Math.max(0, shots.length - 1),
          validatorCode: "shot_boundary_missing_end_boundary",
          failingIndex: index,
        });
      }
      if (shot.endBoundary.timestamp !== shot.end) {
        return invalidValidation("shot_boundary_end_boundary_mismatch", "shot.endBoundary.timestamp 必须等于 shot.end", {
          rawBoundaryCount: Math.max(0, shots.length - 1),
          normalizedBoundaryCount: Math.max(0, shots.length - 1),
          validatorCode: "shot_boundary_end_boundary_mismatch",
          failingIndex: index,
          end: shot.end,
          boundaryTimestamp: shot.endBoundary.timestamp,
        });
      }
    }
    previousEnd = shot.end;
  }
  const boundaries = deriveBoundariesFromShots(rawShots);
  const boundaryValidation = validateTimestampBoundaries(boundaries, durationSeconds, { allowEmpty: true });
  if (!boundaryValidation.ok) return boundaryValidation;
  return {
    ok: true,
    summary: {
      rawBoundaryCount: boundaries.length,
      normalizedBoundaryCount: boundaries.length,
      validatorCode: null,
      schemaVersion: "shot-centric.v2",
    },
    shots,
    boundaries,
  };
}

function validateCommerceBrief(rawBrief) {
  if (rawBrief?.uncertainties !== undefined && !Array.isArray(rawBrief.uncertainties)) {
    return invalidValidation("shot_boundary_commerce_brief_uncertainties_invalid", "commerceBrief.uncertainties 必须为数组", {
      validatorCode: "shot_boundary_commerce_brief_uncertainties_invalid",
      commerceBrief: summarizeCommerceBrief(normalizeCommerceBrief(rawBrief)),
    });
  }
  const brief = normalizeCommerceBrief(rawBrief);
  if (!brief.sellingObject || !brief.proofApproach || !brief.promisedOutcome || !brief.persuasionTarget || !brief.conversionAction) {
    return invalidValidation("shot_boundary_commerce_brief_incomplete", "commerceBrief 关键信息不完整", {
      validatorCode: "shot_boundary_commerce_brief_incomplete",
      commerceBrief: summarizeCommerceBrief(brief),
    });
  }
  return {
    ok: true,
    summary: {
      validatorCode: null,
      commerceBrief: summarizeCommerceBrief(brief),
    },
    commerceBrief: brief,
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
      reason: boundary.reason ?? null,
      summary: resolveShotSummary(safeParsedShots[shots.length]?.summary, boundary.reason),
      endBoundaryReason: boundary.reason ?? null,
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
    reason: boundaries.at(-1)?.reason ?? null,
    summary: resolveShotSummary(safeParsedShots[shots.length]?.summary, boundaries.at(-1)?.reason),
    endBoundaryReason: null,
  });
  return shots
    .filter((shot) => shot.end > shot.start && shot.representativeFrameId)
    .map((shot, index) => ({ ...shot, index, shotNo: formatShotNo(index) }));
}

module.exports = {
  normalizeTimestampBoundaries,
  normalizeShotCentricShots,
  deriveBoundariesFromShots,
  validateTimestampBoundaries,
  validateShotCentricShots,
  validateCommerceBrief,
  buildShotsFromBoundaries,
  detectReasonEncodingIssue,
  summarizeAgentOutput,
};
