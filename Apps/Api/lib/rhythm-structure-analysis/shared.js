const fs = require("fs/promises");
const { createHash } = require("crypto");

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

const MAX_CARDS = 16;
const MAX_EVIDENCE_PER_CARD = 4;
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

function summarizeAgentOutput(message, cards) {
  return {
    messagePreview: String(message ?? "").replace(/\s+/g, " ").slice(0, 200),
    rawCardCount: Array.isArray(cards) ? cards.length : 0,
    labels: Array.isArray(cards) ? cards.slice(0, 6).map((card) => String(card?.label ?? "").slice(0, 40)) : [],
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
    overview: {
      rhythmShape: "整体节奏形态，例如先松后紧、阶梯递进、突然爆发后回落",
      pacingSummary: "用一句话说明快慢、密度、停顿和注意力推进",
      peakRange: "高潮或注意力峰值所在时间范围，可为空字符串",
      turningPoints: ["最关键的节奏转折点"],
      transferableRhythmRule: "可迁移的节奏组织规律，不写成脚本或卖点任务",
      uncertainties: ["证据不足或存在多种读法时写在这里"],
    },
    cards: [
      {
        label: "节奏卡名称",
        rhythmRole: "这段在观感推进中的节奏作用",
        shotRefs: ["shot_1"],
        rhythmPattern: "快慢、密度、停顿、重复、爆点或回落等节奏观察",
        evidence: ["只保留安全摘要"],
        attentionEffect: "它如何影响观众注意力",
        transferableRule: "抽象出的可迁移节奏规律",
        confidence: 0.78,
        needReview: false,
      },
    ],
    notes: "系统会根据 shotRefs 派生 cardId/start/end，模型无需返回这些字段；不要输出音频分析、脚本改写或重切镜头。",
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
  MAX_CARDS,
  MAX_EVIDENCE_PER_CARD,
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

