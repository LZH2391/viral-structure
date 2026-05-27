const { codedError, extractJsonObject, summarizeAgentOutput } = require("../function-slot-atomization-analysis/shared");
const { REVIEW_SCHEMA_VERSION, normalizeText } = require("./shared");

const DECISIONS = new Set(["pass", "rework", "blocked"]);

function validateBoundaryReviewResult(message, turn) {
  const parsed = extractReviewJsonObject(message, turn);
  const decision = normalizeText(parsed?.decision, 20);
  if (!DECISIONS.has(decision)) {
    throw reviewValidationError("function_slot_atomization_boundary_review_decision_invalid", "边界审查结果 decision 无效", parsed, turn, {
      path: "decision",
      decision,
    });
  }
  const issues = normalizeIssues(parsed?.issues);
  if (decision === "pass" && issues.length > 0) {
    throw reviewValidationError("function_slot_atomization_boundary_review_pass_with_issues", "decision 为 pass 时 issues 必须为空", parsed, turn, {
      path: "issues",
      issueCount: issues.length,
    });
  }
  if ((decision === "rework" || decision === "blocked") && !normalizeText(parsed?.reason, 240)) {
    throw reviewValidationError("function_slot_atomization_boundary_review_reason_missing", "rework/blocked 必须提供 reason", parsed, turn, {
      path: "reason",
    });
  }
  return {
    schemaVersion: REVIEW_SCHEMA_VERSION,
    decision,
    reason: normalizeText(parsed?.reason, 360),
    issues,
  };
}

function normalizeIssues(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    issue: normalizeText(item?.issue, 500),
    minimalFix: normalizeText(item?.minimal_fix ?? item?.minimalFix, 500),
    fieldPaths: Array.isArray(item?.field_paths ?? item?.fieldPaths)
      ? (item.field_paths ?? item.fieldPaths).map((path) => normalizeText(path, 180)).filter(Boolean).slice(0, 16)
      : [],
  })).filter((item) => item.issue && item.minimalFix).slice(0, 24);
}

function summarizeBoundaryReviewResult(result) {
  return {
    schemaVersion: result?.schemaVersion ?? REVIEW_SCHEMA_VERSION,
    decision: result?.decision ?? null,
    issueCount: Array.isArray(result?.issues) ? result.issues.length : 0,
  };
}

function extractReviewJsonObject(message, turn) {
  try {
    return extractJsonObject(message);
  } catch (error) {
    throw reviewValidationError("function_slot_atomization_boundary_review_parse_failed", "边界审查结果不是合法 JSON object", null, turn, {
      path: "$",
      parserMessage: error instanceof Error ? error.message : String(error ?? "JSON parse failed"),
    });
  }
}

function reviewValidationError(code, message, parsed, turn, extra = {}) {
  return codedError(code, message, {
    turnId: turn?.turnId ?? null,
    outputSchemaVersion: REVIEW_SCHEMA_VERSION,
    outputSummary: summarizeAgentOutput(JSON.stringify(parsed ?? {}), parsed),
    validation: {
      validatorCode: code,
      message,
      ...extra,
    },
  }, false);
}

module.exports = {
  validateBoundaryReviewResult,
  summarizeBoundaryReviewResult,
};
