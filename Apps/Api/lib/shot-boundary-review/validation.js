const { codedError, extractJsonObject } = require("../shot-boundary-analysis/shared");
const {
  REVIEW_RESULT_SCHEMA_VERSION,
  normalizeText,
  shotNumberFromShotNo,
} = require("./shared");

function validateReviewResult(message, shotAnalysis, turn) {
  const parsed = extractJsonObject(message);
  const decision = String(parsed?.decision ?? "").trim();
  if (!["pass", "rework", "blocked"].includes(decision)) {
    throw reviewValidationError("shot_boundary_review_decision_invalid", "切镜审查结果 decision 无效", parsed, turn);
  }
  const issues = Array.isArray(parsed?.issues) ? parsed.issues : null;
  if (!issues) {
    throw reviewValidationError("shot_boundary_review_issues_invalid", "切镜审查结果 issues 必须为数组", parsed, turn);
  }
  if (decision === "pass" && issues.length > 0) {
    throw reviewValidationError("shot_boundary_review_pass_with_issues", "pass 结果不能包含 issues", parsed, turn);
  }
  if (decision === "rework" && issues.length === 0) {
    throw reviewValidationError("shot_boundary_review_rework_without_issues", "rework 必须包含可执行 issues", parsed, turn);
  }
  const maxShotNo = Array.isArray(shotAnalysis?.shots) ? shotAnalysis.shots.length : 0;
  const normalizedIssues = issues.map((issue, index) => normalizeIssue(issue, index, maxShotNo, parsed, turn));
  return {
    schemaVersion: REVIEW_RESULT_SCHEMA_VERSION,
    decision,
    reason: normalizeText(parsed?.reason, 200) || defaultReason(decision),
    issues: normalizedIssues,
  };
}

function normalizeIssue(issue, index, maxShotNo, parsed, turn) {
  const issueText = normalizeText(issue?.issue, 200);
  const minimalFix = normalizeText(issue?.minimal_fix, 240);
  const rawShotIds = Array.isArray(issue?.shot_ids) ? issue.shot_ids : null;
  if (!issueText || !minimalFix || !rawShotIds) {
    throw reviewValidationError("shot_boundary_review_issue_contract_invalid", "review issue 缺少 issue/minimal_fix/shot_ids", parsed, turn, { failingIndex: index });
  }
  const shotIds = rawShotIds.map((value) => Number(value)).filter((value) => Number.isInteger(value));
  if (shotIds.length !== rawShotIds.length || shotIds.some((value) => value < 1 || value > maxShotNo)) {
    throw reviewValidationError("shot_boundary_review_issue_shot_ids_invalid", "review issue 引用了不存在的镜头", parsed, turn, { failingIndex: index, maxShotNo });
  }
  return {
    issue: issueText,
    minimal_fix: minimalFix,
    shot_ids: shotIds,
  };
}

function buildAnalyzerReviewReworkError(reviewResult, reviewReworkCount) {
  return codedError("shot_boundary_review_rework", "切镜 reviewer 要求返工", {
    review: summarizeReviewResult(reviewResult),
    validation: {
      validatorCode: "shot_boundary_review_rework",
      reviewDecision: reviewResult.decision,
      issueCount: reviewResult.issues.length,
      reworkCount: reviewReworkCount,
      minimalFixes: reviewResult.issues.map((issue) => issue.minimal_fix),
    },
  }, false);
}

function summarizeReviewResult(reviewResult) {
  return {
    schemaVersion: reviewResult?.schemaVersion ?? REVIEW_RESULT_SCHEMA_VERSION,
    decision: reviewResult?.decision ?? null,
    reason: normalizeText(reviewResult?.reason, 200),
    issueCount: Array.isArray(reviewResult?.issues) ? reviewResult.issues.length : 0,
    issues: Array.isArray(reviewResult?.issues)
      ? reviewResult.issues.map((issue) => ({
        issue: normalizeText(issue.issue, 160),
        minimal_fix: normalizeText(issue.minimal_fix, 160),
        shot_ids: issue.shot_ids,
      }))
      : [],
  };
}

function reviewValidationError(code, message, parsed, turn, extra = {}) {
  return codedError(code, message, {
    turnId: turn?.turnId ?? null,
    outputSchemaVersion: REVIEW_RESULT_SCHEMA_VERSION,
    outputSummary: {
      decision: parsed?.decision ?? null,
      hasReason: Boolean(parsed?.reason),
      issueCount: Array.isArray(parsed?.issues) ? parsed.issues.length : null,
    },
    validation: {
      validatorCode: code,
      ...extra,
    },
  }, false);
}

function defaultReason(decision) {
  if (decision === "pass") return "未发现明确切镜问题";
  if (decision === "blocked") return "输入不足，无法完成切镜审查";
  return "存在需要返工的切镜问题";
}

module.exports = {
  validateReviewResult,
  buildAnalyzerReviewReworkError,
  summarizeReviewResult,
  shotNumberFromShotNo,
};
