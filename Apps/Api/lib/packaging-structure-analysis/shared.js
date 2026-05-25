const fs = require("fs/promises");
const { createHash } = require("crypto");

const ROLE = "packaging-structure-analyzer";
const SKILL_PATH = "C:/ByteDanceFullStack/.agents/skills/packaging-structure-analyzer/SKILL.md";
const STAGES = {
  inputPrepared: "packaging_structure.input_prepare",
  inputPackaged: "packaging_structure.input_package",
  cacheLookup: "packaging_structure.cache_lookup",
  analyzed: "packaging_structure.analyze",
  validated: "packaging_structure.validate",
  repaired: "packaging_structure.repair",
  cacheReuse: "packaging_structure.cache_reuse",
  materialized: "packaging_structure.materialize",
};

const MAX_SHOT_NOTES = 120;
const MAX_PACKAGING_BLOCKS = 24;
const MAX_STACK_ITEMS = 24;
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
    code: error?.code ?? "packaging_structure_failed",
    message: error instanceof Error ? error.message : "包装结构分析失败",
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
    requestTimeoutMs: details?.requestTimeoutMs ?? details?.lastRequestError?.request?.requestTimeoutMs ?? null,
    readinessDetail: details?.readinessDetail ?? details?.threadPool ?? null,
    lastRequestError: details?.lastRequestError ?? details?.requestError ?? null,
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
  if (start < 0 || end < start) throw codedError("agent_output_parse_failed", "包装结构 Agent 未返回 JSON 对象");
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

function summarizeAgentOutput(message, parsed) {
  const notes = Array.isArray(parsed?.shotPackagingNotes) ? parsed.shotPackagingNotes : [];
  const blocks = Array.isArray(parsed?.packagingBlocks) ? parsed.packagingBlocks : [];
  return {
    messagePreview: String(message ?? "").replace(/\s+/g, " ").slice(0, 200),
    rawShotPackagingNoteCount: notes.length,
    rawPackagingBlockCount: blocks.length,
    labels: blocks.slice(0, 6).map((block) => String(block?.label ?? "").slice(0, 40)),
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
      summary: "整体包装风格摘要，只描述样例里实际出现的字幕、标题条、贴纸、画中画、音效、转场和信息层级",
      fields: [
        {
          label: "开放字段名称，例如主包装风格、信息密度、首屏策略、视觉层级",
          value: "对应字段内容，只描述包装现象和支撑信号，不写迁移规则",
        },
      ],
      uncertainties: ["证据不足或存在多种读法时写在这里"],
    },
    shotPackagingNotes: [
      {
        shotRef: "shot_1",
        fields: [
          {
            label: "开放字段名称，例如字幕密度、字幕样式、标题条、贴纸、画中画、音效候选、信息层级",
            value: "对应字段内容，只描述这一镜内部包装现象和支撑信号",
          },
        ],
        packagingFunction: "这一镜包装主要服务什么理解或说服功能",
        confidence: 0.78,
        needReview: false,
      },
    ],
    packagingBlocks: [
      {
        label: "开放命名的包装模式",
        shotRefs: ["shot_1"],
        fields: [
          {
            label: "开放字段名称，例如包装元素组合、画面层级、声画同步、转场包装",
            value: "对应字段内容，只描述该包装模式的现象和支撑信号",
          },
        ],
        packagingFunction: "这个包装模式如何服务卖点、证据、信任或转化",
        confidence: 0.78,
        needReview: false,
      },
    ],
    claimStack: [
      {
        label: "被包装出来的承诺或卖点",
        shotRefs: ["shot_1"],
        fields: [{ label: "视觉化方式", value: "承诺或卖点如何被字幕、标题、贴纸、画中画或音效强调" }],
      },
    ],
    proofStack: [
      {
        label: "被包装出来的证据方式",
        shotRefs: ["shot_1"],
        fields: [{ label: "证明包装", value: "证据如何被实拍、对比、演示、字幕解释、贴纸强调或画中画补充" }],
      },
    ],
    conversionWrap: {
      summary: "转化动作如何被包装；如果没有明确转化包装，写无明确转化包装",
      fields: [{ label: "行动包装", value: "价格/福利提示、行动贴纸、按钮感、弹出式提示等" }],
      shotRefs: ["shot_1"],
      uncertainties: [],
    },
    notes: "系统会根据 shotRefs/shotRef 派生 id/start/end，模型无需返回这些字段；不要输出迁移规则、音频分析、脚本改写或重切镜头。",
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
  MAX_SHOT_NOTES,
  MAX_PACKAGING_BLOCKS,
  MAX_STACK_ITEMS,
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


