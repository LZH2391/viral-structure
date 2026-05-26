const { codedError, extractJsonObject } = require("../shot-boundary-analysis/shared");
const {
  validateShotCentricShots,
  validateCommerceBrief,
  summarizeAgentOutput,
} = require("../shot-boundary-analysis");
const {
  TRANSFORM_RESULT_SCHEMA_VERSION,
  normalizeText,
} = require("./shared");

function validateTransformResult(message, prepared, turn) {
  const parsed = extractTransformJsonObject(message, turn);
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
    commerceBrief: commerceValidation.commerceBrief,
  };
}

function summarizeTransformResult(result) {
  return {
    schemaVersion: result?.schemaVersion ?? TRANSFORM_RESULT_SCHEMA_VERSION,
    shotCount: Array.isArray(result?.shots) ? result.shots.length : 0,
    boundaryCount: Array.isArray(result?.boundaries) ? result.boundaries.length : 0,
    hasSellingObject: Boolean(result?.commerceBrief?.sellingObject),
  };
}

function validateVisualSummaryResult(message, shots, turn, expectedCommerceBrief = null) {
  const parsed = extractTransformJsonObject(message, turn, {
    code: "shot_boundary_visual_summary_parse_failed",
    message: "视觉摘要结果不是合法 JSON object",
  });
  if (!Array.isArray(parsed?.shots)) {
    throw transformValidationError("shot_boundary_visual_summary_contract_invalid", "视觉摘要结果缺少 shots", parsed, turn);
  }
  const expectedBriefValidation = expectedCommerceBrief ? validateCommerceBrief(expectedCommerceBrief) : null;
  if (expectedBriefValidation?.ok) {
    if (!Object.prototype.hasOwnProperty.call(parsed ?? {}, "commerceBrief")) {
      throw transformValidationError("shot_boundary_visual_summary_commerce_missing", "视觉摘要结果缺少 commerceBrief", parsed, turn);
    }
    const actualBriefValidation = validateCommerceBrief(parsed.commerceBrief);
    if (!actualBriefValidation.ok) {
      throw transformValidationError("shot_boundary_visual_summary_commerce_invalid", "视觉摘要 commerceBrief 不完整", parsed, turn, actualBriefValidation.summary);
    }
    if (JSON.stringify(actualBriefValidation.commerceBrief) !== JSON.stringify(expectedBriefValidation.commerceBrief)) {
      throw transformValidationError("shot_boundary_visual_summary_commerce_changed", "视觉摘要不得改写 commerceBrief", parsed, turn, {
        expectedCommerceBrief: expectedBriefValidation.summary.commerceBrief,
        actualCommerceBrief: actualBriefValidation.summary.commerceBrief,
      });
    }
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
  const validation = normalizeValidationSummary(code, message, extra);
  return codedError(code, message, {
    turnId: turn?.turnId ?? null,
    outputSchemaVersion: TRANSFORM_RESULT_SCHEMA_VERSION,
    outputSummary: summarizeAgentOutput(JSON.stringify(parsed ?? {}), null, null, parsed?.shots),
    validation,
  }, false);
}

function extractTransformJsonObject(message, turn, options = {}) {
  try {
    return extractJsonObject(message);
  } catch (error) {
    const code = options.code ?? "shot_boundary_transform_parse_failed";
    const summary = {
      code: error?.code ?? "agent_output_parse_failed",
      message: error instanceof Error ? error.message : String(error ?? "JSON parse failed"),
      path: "$",
      readableMessage: buildParseReadableMessage(error),
    };
    throw transformValidationError(code, options.message ?? "转换器结果不是合法 JSON object", null, turn, summary);
  }
}

function normalizeValidationSummary(code, message, extra = {}) {
  const path = extra.path ?? inferValidationPath(extra);
  const readableMessage = extra.readableMessage ?? buildReadableMessage(message, path, extra);
  return {
    message,
    readableMessage,
    path,
    validatorCode: code,
    ...extra,
  };
}

function inferValidationPath(extra = {}) {
  const failingIndex = Number.isInteger(extra.failingIndex) ? extra.failingIndex : null;
  const validatorCode = String(extra.validatorCode ?? "");
  if (validatorCode.includes("commerce_brief")) return "commerceBrief";
  if (failingIndex !== null) return `shots[${failingIndex}]`;
  return "$";
}

function buildReadableMessage(message, path, extra = {}) {
  const parts = [path ? `${path}: ${message}` : message];
  if (extra.shotRef) parts.push(`shotRef=${extra.shotRef}`);
  if (Number.isFinite(extra.timestamp)) parts.push(`timestamp=${extra.timestamp}`);
  if (Number.isFinite(extra.start)) parts.push(`start=${extra.start}`);
  if (Number.isFinite(extra.end)) parts.push(`end=${extra.end}`);
  if (Number.isFinite(extra.durationSeconds)) parts.push(`durationSeconds=${extra.durationSeconds}`);
  return parts.join("；");
}

function buildParseReadableMessage(error) {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const positionMatch = text.match(/position\s+(\d+)/i);
  const lineColumnMatch = text.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (lineColumnMatch) return `输出不是合法 JSON object，解析失败位置: line ${lineColumnMatch[1]}, column ${lineColumnMatch[2]}`;
  if (positionMatch) return `输出不是合法 JSON object，解析失败位置: position ${positionMatch[1]}`;
  return "输出不是合法 JSON object，解析失败位置: $";
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
