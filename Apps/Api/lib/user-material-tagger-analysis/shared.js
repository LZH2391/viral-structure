const fs = require("fs/promises");
const { createHash } = require("crypto");
const { summarizeAppServerBridgeDebug } = require("../analysis-runtime-v2/debug-sanitize");

const ROLE = "user-material-tagger";
const SKILL_PATH = "C:/ByteDanceFullStack/.agents/skills/user-material-tagger/SKILL.md";
const STAGES = {
  inputPrepared: "user_material_tagger.input_prepare",
  inputPackaged: "user_material_tagger.input_package",
  cacheLookup: "user_material_tagger.cache_lookup",
  analyzed: "user_material_tagger.analyze",
  validated: "user_material_tagger.validate",
  repaired: "user_material_tagger.repair",
  cacheReuse: "user_material_tagger.cache_reuse",
  materialized: "user_material_tagger.materialize",
};

const MAX_TEXT_FIELD_LENGTH = 240;
const MAX_SUMMARY_LENGTH = 480;
const MAX_SHOT_CARDS = 180;
const MAX_MATERIAL_GROUPS = 48;
const MAX_SEQUENCE_CANDIDATES = 8;
const PROOF_NEED_CLASSES = [
  "problem_visibility",
  "product_identity",
  "process_demonstration",
  "mechanism_support",
  "result_evidence",
  "comparison_evidence",
  "trust_evidence",
  "conversion_support",
];

function codedError(code, message, debugPayload = null, retryable = true) {
  const error = new Error(message);
  error.code = code;
  error.debugPayload = debugPayload;
  error.retryable = retryable;
  return error;
}

function safeError(error, stageName) {
  return {
    code: error?.code ?? "user_material_tagger_failed",
    message: error instanceof Error ? error.message : "用户素材识别失败",
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
    activeThreadMessagePreview: details?.activeThreadMessagePreview ?? null,
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
  if (start < 0 || end < start) throw codedError("agent_output_parse_failed", "用户素材识别 Agent 未返回 JSON 对象");
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
  return {
    messagePreview: String(message ?? "").replace(/\s+/g, " ").slice(0, 200),
    rawShotCardCount: Array.isArray(parsed?.shotCards) ? parsed.shotCards.length : 0,
    rawMaterialGroupCount: Array.isArray(parsed?.materialGroups) ? parsed.materialGroups.length : 0,
    rawProofCoverageCount: Array.isArray(parsed?.proofCoverage) ? parsed.proofCoverage.length : 0,
  };
}

function normalizeText(value, maxLength = MAX_TEXT_FIELD_LENGTH) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeStringArray(value, maxLength = 12) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeText(item)).filter(Boolean).slice(0, maxLength);
}

function normalizeConfidence(value, fallback = 0.72) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(0, Math.min(1, Math.round(next * 1000) / 1000));
}

function stableJson(value) {
  return JSON.stringify(sortObject(value));
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = sortObject(value[key]);
    return result;
  }, {});
}

function buildOutputContract() {
  return {
    type: "user-material-pack",
    schemaVersion: "user-material-pack.stable",
    requiredTopLevelFields: [
      "type",
      "schemaVersion",
      "sampleVideoId",
      "sourceArtifacts",
      "semanticDictionaries",
      "shotCards",
      "materialGroups",
      "proofCoverage",
      "sequenceRecommendations",
      "globalConstraintRefs",
      "restructureInputSummary",
    ],
    notes: [
      "只返回 JSON object。",
      "优先复制 output-skeleton.json 的整体结构，再补全语义判断字段；不要先输出展开结构再二次压缩。",
      "脚本预填的 shotRef、shotNo、timeRange、visualSummary 来自切镜事实，不要改写或删减。",
      "重复实体、所需支持、限制、缺口和安全边界必须直接写入 semanticDictionaries，并在正文使用 Ref 字段引用。",
      "每个输入 shot 必须有一个 shotCard。",
      "proofCoverage 必须覆盖全部 proofNeedClass。",
      "不要输出高光片段列表；只输出结构位置适配候选。",
      "materialGroups、proofCoverage、sequenceRecommendations 和 restructureInputSummary 必须由 Agent 基于素材判断补全；不要让空骨架直接通过。",
    ],
    compactRefFields: {
      semanticDictionaries: ["entityDict", "supportDict", "guardrailDict"],
      shotCards: ["detectedEntityRefs", "proofAffordances[].limitRefs", "sequenceFit.*.requiredSupportRefs", "constraintRefs"],
      materialGroups: ["constraintRefs"],
      proofCoverage: ["safeUsageRefs", "gapAdviceRefs"],
      sequenceRecommendations: ["*.requiredSupportRefs"],
      topLevel: ["globalConstraintRefs", "restructureInputSummary.doNotUseForRefs", "restructureInputSummary.needsRestructureAttentionRefs"],
    },
    proofNeedClasses: PROOF_NEED_CLASSES,
  };
}

module.exports = {
  ROLE,
  SKILL_PATH,
  STAGES,
  MAX_TEXT_FIELD_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_SHOT_CARDS,
  MAX_MATERIAL_GROUPS,
  MAX_SEQUENCE_CANDIDATES,
  PROOF_NEED_CLASSES,
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
