const { codedError, extractJsonObject } = require("../shot-boundary-analysis/shared");
const {
  validateShotCentricShots,
  validateCommerceBrief,
  summarizeAgentOutput,
} = require("../shot-boundary-analysis");
const {
  TRANSFORM_RESULT_SCHEMA_VERSION,
  normalizeText,
  MAX_TRANSFORM_VIDEO_SUMMARY_LENGTH,
} = require("./shared");

function validateTransformResult(message, prepared, turn) {
  const parsed = extractJsonObject(message);
  if (Object.prototype.hasOwnProperty.call(parsed ?? {}, "decision")) {
    throw transformValidationError("shot_boundary_transform_legacy_review_result", "转换器返回了旧版 reviewer contract", parsed, turn);
  }
  if (!Array.isArray(parsed?.shots) || !Object.prototype.hasOwnProperty.call(parsed ?? {}, "commerceBrief")) {
    throw transformValidationError("shot_boundary_transform_contract_invalid", "转换器结果缺少 shots 或 commerceBrief", parsed, turn);
  }
  const shotValidation = validateShotCentricShots(parsed.shots, prepared.durationSeconds);
  if (!shotValidation.ok) {
    throw transformValidationError("shot_boundary_transform_shots_invalid", shotValidation.message, parsed, turn, shotValidation.summary);
  }
  const commerceValidation = validateCommerceBrief(parsed.commerceBrief);
  if (!commerceValidation.ok) {
    throw transformValidationError("shot_boundary_transform_commerce_invalid", commerceValidation.message, parsed, turn, commerceValidation.summary);
  }
  return {
    schemaVersion: TRANSFORM_RESULT_SCHEMA_VERSION,
    shots: shotValidation.shots,
    boundaries: shotValidation.boundaries,
    commerceBrief: {
      ...commerceValidation.commerceBrief,
      videoSummary: normalizeText(parsed?.videoSummary, MAX_TRANSFORM_VIDEO_SUMMARY_LENGTH),
    },
  };
}

function summarizeTransformResult(result) {
  return {
    schemaVersion: result?.schemaVersion ?? TRANSFORM_RESULT_SCHEMA_VERSION,
    shotCount: Array.isArray(result?.shots) ? result.shots.length : 0,
    boundaryCount: Array.isArray(result?.boundaries) ? result.boundaries.length : 0,
    hasSellingObject: Boolean(result?.commerceBrief?.sellingObject),
    hasVideoSummary: Boolean(result?.commerceBrief?.videoSummary),
  };
}

function validateVisualSummaryResult(message, shots, turn) {
  const parsed = extractJsonObject(message);
  if (!Array.isArray(parsed?.shots)) {
    throw transformValidationError("shot_boundary_visual_summary_contract_invalid", "视觉摘要结果缺少 shots", parsed, turn);
  }
  const sourceShots = Array.isArray(shots) ? shots : [];
  if (parsed.shots.length !== sourceShots.length) {
    throw transformValidationError("shot_boundary_visual_summary_count_mismatch", "视觉摘要 shots 数量与切镜结果不一致", parsed, turn, {
      expectedShotCount: sourceShots.length,
      actualShotCount: parsed.shots.length,
    });
  }
  const summaries = sourceShots.map((shot, index) => {
    const raw = parsed.shots[index] ?? {};
    const summary = normalizeText(raw.summary, 120);
    if (!summary) {
      throw transformValidationError("shot_boundary_visual_summary_empty", "视觉摘要 summary 不能为空", parsed, turn, {
        failingIndex: index,
        shotNo: shot?.shotNo ?? null,
      });
    }
    return {
      index,
      shotNo: shot?.shotNo ?? raw.shotNo ?? null,
      summary,
    };
  });
  return { shots: summaries };
}

function applyVisualSummaryResult(result, visualSummary) {
  const summaries = Array.isArray(visualSummary?.shots) ? visualSummary.shots : [];
  return {
    ...result,
    shots: (Array.isArray(result?.shots) ? result.shots : []).map((shot, index) => ({
      ...shot,
      summary: summaries[index]?.summary ?? shot.summary,
    })),
  };
}

function summarizeVisualSummaryResult(result) {
  return {
    shotCount: Array.isArray(result?.shots) ? result.shots.length : 0,
    emptySummaryCount: Array.isArray(result?.shots) ? result.shots.filter((shot) => !shot?.summary).length : 0,
  };
}

function transformValidationError(code, message, parsed, turn, extra = {}) {
  return codedError(code, message, {
    turnId: turn?.turnId ?? null,
    outputSchemaVersion: TRANSFORM_RESULT_SCHEMA_VERSION,
    outputSummary: summarizeAgentOutput(JSON.stringify(parsed ?? {}), null, null, parsed?.shots),
    validation: {
      validatorCode: code,
      ...extra,
    },
  }, false);
}

module.exports = {
  validateTransformResult,
  summarizeTransformResult,
  validateVisualSummaryResult,
  applyVisualSummaryResult,
  summarizeVisualSummaryResult,
  validateReviewResult: validateTransformResult,
  summarizeReviewResult: summarizeTransformResult,
};
