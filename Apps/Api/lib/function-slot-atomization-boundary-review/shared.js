const { createHash } = require("crypto");
const { summarizeAppServerBridgeDebug } = require("../analysis-runtime-v2/debug-sanitize");

const REVIEW_ROLE = "function-slot-atomization-boundary-reviewer";
const REVIEW_SKILL_PATH = "C:/ByteDanceFullStack/.agents/skills/function-slot-atomization-boundary-reviewer/SKILL.md";
const REVIEW_SCHEMA_VERSION = "function_slot_atomization_boundary_review.v1";

function normalizeText(value, maxLength = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function contentHash(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function safeReviewError(error, stageName) {
  return {
    code: error?.code ?? "function_slot_atomization_boundary_review_failed",
    message: error instanceof Error ? error.message : "功能槽位原子化边界审查失败",
    stageName,
    retryable: typeof error?.retryable === "boolean" ? error.retryable : true,
  };
}

function sanitizeReviewDebugPayload(error) {
  const details = error?.debugPayload ?? null;
  return {
    code: error?.code ?? null,
    message: error instanceof Error ? error.message : String(error ?? "unknown").slice(0, 240),
    turnId: details?.turnId ?? null,
    status: details?.status ?? null,
    appServerMessage: details?.message ?? null,
    outputSummary: details?.outputSummary ?? null,
    validation: details?.validation ?? null,
    readinessDetail: details?.readinessDetail ?? details?.threadPool ?? null,
    bridge: summarizeAppServerBridgeDebug(details),
  };
}

module.exports = {
  REVIEW_ROLE,
  REVIEW_SKILL_PATH,
  REVIEW_SCHEMA_VERSION,
  normalizeText,
  contentHash,
  safeReviewError,
  sanitizeReviewDebugPayload,
};
