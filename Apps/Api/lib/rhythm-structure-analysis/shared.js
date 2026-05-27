const fs = require("fs/promises");
const { createHash } = require("crypto");
const { summarizeAppServerBridgeDebug } = require("../analysis-runtime-v2/debug-sanitize");

const ROLE = "rhythm-structure-analyzer";
const SKILL_PATH = "C:/ByteDanceFullStack/.agents/skills/rhythm-structure-analyzer/SKILL.md";
const STAGES = {
  inputPrepared: "rhythm_structure.input_prepare",
  inputPackaged: "rhythm_structure.input_package",
  cacheLookup: "rhythm_structure.cache_lookup",
  analyzed: "rhythm_structure.analyze",
  validated: "rhythm_structure.validate",
  repaired: "rhythm_structure.repair",
  cacheReuse: "rhythm_structure.cache_reuse",
  materialized: "rhythm_structure.materialize",
};

const MAX_SECTIONS = 16;
const MAX_FIELDS_PER_SCOPE = 12;
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
    code: error?.code ?? "rhythm_structure_failed",
    message: error instanceof Error ? error.message : "节奏结构分析失败",
    stageName,
    retryable: typeof error?.retryable === "boolean" ? error.retryable : true,
    validatorCode: error?.debugPayload?.validation?.validatorCode ?? null,
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
    timeoutReason: details?.timeoutReason ?? null,
    idleTimeoutMs: details?.idleTimeoutMs ?? null,
    hardTimeoutMs: details?.hardTimeoutMs ?? null,
    elapsedMs: details?.elapsedMs ?? null,
    idleElapsedMs: details?.idleElapsedMs ?? null,
    lastProgressAt: details?.lastProgressAt ?? null,
    lastStatus: details?.lastStatus ?? null,
    activeThreadMessagePreview: details?.activeThreadMessagePreview ?? null,
    turnActivity: details?.turnActivity ?? null,
    requestTimeoutMs: details?.requestTimeoutMs ?? details?.lastRequestError?.request?.requestTimeoutMs ?? null,
    readinessDetail: details?.readinessDetail ?? details?.threadPool ?? null,
    lastRequestError: details?.lastRequestError ?? details?.requestError ?? null,
    bridge: summarizeAppServerBridgeDebug(details),
    outputSummary: details?.outputSummary ?? null,
    validation: details?.validation ?? null,
    validatorCode: details?.validation?.validatorCode ?? null,
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
  if (start < 0 || end < start) throw codedError("agent_output_parse_failed", "节奏结构 Agent 未返回 JSON 对象");
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

function summarizeAgentOutput(message, sections) {
  return {
    messagePreview: String(message ?? "").replace(/\s+/g, " ").slice(0, 200),
    rawSectionCount: Array.isArray(sections) ? sections.length : 0,
    labels: Array.isArray(sections) ? sections.slice(0, 6).map((section) => String(section?.label ?? "").slice(0, 40)) : [],
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

function normalizeFieldArray(value, maxLength = MAX_FIELDS_PER_SCOPE) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      label: normalizeText(item?.label, 60),
      value: normalizeText(item?.value, 240),
    }))
    .filter((item) => item.label && item.value)
    .slice(0, maxLength);
}

function normalizeConfidence(value, fallback = 0.72) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(0, Math.min(1, Math.round(next * 1000) / 1000));
}

function buildOutputContract() {
  return {
    overview: {
      summary: "整体节奏现象摘要，只描述样例中实际发生的快慢、密度、停顿、爆点、回落等变化",
      fields: [
        {
          label: "开放字段名称，例如节奏形态、密度变化、停顿位置、爆点范围",
          value: "对应字段内容，只描述节奏现象，不写迁移规则",
        },
      ],
      uncertainties: ["证据不足或存在多种读法时写在这里"],
    },
    sections: [
      {
        label: "节奏区间名称，开放命名",
        shotRefs: ["shot_1"],
        fields: [
          {
            label: "开放字段名称，例如节奏观察、结构信号、停顿位置、爆点范围",
            value: "对应字段内容，只描述这个区间的节奏现象和支撑信号",
          },
        ],
        confidence: 0.78,
        needReview: false,
      },
    ],
    notes: "系统会根据 shotRefs 派生 sectionId/start/end，模型无需返回这些字段；不要输出迁移规则、音频分析、脚本改写或重切镜头。",
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
  MAX_SECTIONS,
  MAX_FIELDS_PER_SCOPE,
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
  normalizeFieldArray,
  normalizeConfidence,
  buildOutputContract,
  stableJson,
};

