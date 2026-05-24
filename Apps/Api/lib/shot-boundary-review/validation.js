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
  validateReviewResult: validateTransformResult,
  summarizeReviewResult: summarizeTransformResult,
};
