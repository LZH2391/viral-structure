const fs = require("fs/promises");
const { createHash } = require("crypto");

const ROLE = "script-segment-analyzer";
const SKILL_PATH = "C:/ByteDanceFullStack/.agents/skills/script-segment-analyzer/SKILL.md";
const STAGES = {
  inputPrepared: "script_segment.input_prepare",
  inputPackaged: "script_segment.input_package",
  cacheLookup: "script_segment.cache_lookup",
  analyzed: "script_segment.analyze",
  validated: "script_segment.validate",
  repaired: "script_segment.repair",
  cacheReuse: "script_segment.cache_reuse",
  materialized: "script_segment.materialize",
};

const MAX_SEGMENTS = 12;
const MAX_EVIDENCE_PER_SEGMENT = 3;
const MAX_TEXT_FIELD_LENGTH = 120;
const MAX_UNCERTAINTIES = 5;

function codedError(code, message, debugPayload = null, retryable = true) {
  const error = new Error(message);
  error.code = code;
  error.debugPayload = debugPayload;
  error.retryable = retryable;
  return error;
}

function safeError(error, stageName) {
  return {
    code: error?.code ?? "script_segment_failed",
    message: error instanceof Error ? error.message : "脚本段落分析失败",
    stageName,
    retryable: typeof error?.retryable === "boolean" ? error.retryable : true,
  };
}

function sanitizeDebugPayload(error) {
  const details = error?.debugPayload ?? null;
  return {
    code: error?.code ?? null,
    message: error instanceof Error ? error.message : String(error ?? "unknown").slice(0, 240),
    turnId: details?.turnId ?? null,
    status: details?.status ?? null,
    appServerMessage: details?.message ?? null,
    attemptCount: details?.attemptCount ?? null,
    requestTimeoutMs: details?.requestTimeoutMs ?? details?.lastRequestError?.request?.requestTimeoutMs ?? null,
    readinessDetail: details?.readinessDetail ?? details?.threadPool ?? null,
    lastRequestError: details?.lastRequestError ?? details?.requestError ?? null,
    outputSummary: details?.outputSummary ?? null,
    validation: details?.validation ?? null,
    repairAttemptCount: details?.repairAttemptCount ?? null,
  };
}

function sanitizeForAppServerText(value) {
  if (typeof value === "string") return value.replace(/[\uD800-\uDFFF]/g, "");
  if (Array.isArray(value)) return value.map((item) => sanitizeForAppServerText(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeForAppServerText(item)]));
}

function extractJsonObject(text) {
  const value = String(text ?? "").trim();
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end < start) throw codedError("agent_output_parse_failed", "脚本段落 Agent 未返回 JSON 对象");
  try {
    return JSON.parse(value.slice(start, end + 1));
  } catch (error) {
    error.code = "agent_output_parse_failed";
    throw error;
  }
}

function contentHash(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

async function resolveSkillHash(skillPath = SKILL_PATH) {
  try {
    return contentHash(await fs.readFile(skillPath, "utf8"));
  } catch {
    return contentHash(String(skillPath ?? ""));
  }
}

function summarizeAgentOutput(message, segments) {
  return {
    messagePreview: String(message ?? "").replace(/\s+/g, " ").slice(0, 200),
    rawSegmentCount: Array.isArray(segments) ? segments.length : 0,
    labels: Array.isArray(segments) ? segments.slice(0, 6).map((segment) => String(segment?.label ?? "").slice(0, 40)) : [],
  };
}

function normalizeText(value, maxLength = MAX_TEXT_FIELD_LENGTH) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeStringArray(value, maxLength) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeText(item))
    .filter(Boolean)
    .slice(0, maxLength);
}

function normalizeConfidence(value, fallback = 0.72) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(0, Math.min(1, Math.round(next * 1000) / 1000));
}

function buildOutputContract() {
  return {
    segments: [
      {
        label: "段落名称",
        roleInScript: "该段在样例脚本中的职责",
        shotRefs: ["shot_1"],
        evidence: ["只保留安全摘要"],
        transferableRule: "抽象出的可迁移结构规则",
        confidence: 0.78,
        needReview: false,
      },
    ],
    notes: "系统会根据 shotRefs 派生 segmentId/start/end，模型无需返回这些字段",
  };
}

function stableJson(value) {
  return JSON.stringify(sortObject(value));
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value)
    .sort()
    .reduce((result, key) => {
      result[key] = sortObject(value[key]);
      return result;
    }, {});
}

module.exports = {
  ROLE,
  SKILL_PATH,
  STAGES,
  MAX_SEGMENTS,
  MAX_EVIDENCE_PER_SEGMENT,
  MAX_TEXT_FIELD_LENGTH,
  MAX_UNCERTAINTIES,
  codedError,
  safeError,
  sanitizeDebugPayload,
  sanitizeForAppServerText,
  extractJsonObject,
  contentHash,
  resolveSkillHash,
  summarizeAgentOutput,
  normalizeText,
  normalizeStringArray,
  normalizeConfidence,
  buildOutputContract,
  stableJson,
};
