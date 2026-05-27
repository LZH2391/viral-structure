const fs = require("fs/promises");
const { createHash } = require("crypto");
const { summarizeAppServerBridgeDebug } = require("../analysis-runtime-v2/debug-sanitize");

const ROLE = "function-slot-atomization-analyzer";
const SKILL_PATH = "C:/ByteDanceFullStack/.agents/skills/function-slot-atomization-analyzer/SKILL.md";
const STAGES = {
  inputPrepared: "function_slot_atomization.input_prepare",
  inputPackaged: "function_slot_atomization.input_package",
  cacheLookup: "function_slot_atomization.cache_lookup",
  analyzed: "function_slot_atomization.analyze",
  validated: "function_slot_atomization.validate",
  repaired: "function_slot_atomization.repair",
  finalOutputPrepared: "function_slot_atomization.final_output_prepare",
  boundaryReviewed: "function_slot_atomization.boundary_review",
  boundaryReworked: "function_slot_atomization.boundary_rework",
  cacheReuse: "function_slot_atomization.cache_reuse",
  materialized: "function_slot_atomization.materialize",
};

const MAX_TEXT_FIELD_LENGTH = 180;
const MAX_LONG_TEXT_FIELD_LENGTH = 480;
const MAX_ARRAY_ITEMS = 24;
const MAX_RULES = 24;
const MAX_SLOTS = 16;
const MAX_ATOMS = 64;

function codedError(code, message, debugPayload = null, retryable = true) {
  const error = new Error(message);
  error.code = code;
  error.debugPayload = debugPayload;
  error.retryable = retryable;
  return error;
}

function safeError(error, stageName) {
  return {
    code: error?.code ?? "function_slot_atomization_failed",
    message: error instanceof Error ? error.message : "功能槽位原子化失败",
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
    bridge: summarizeAppServerBridgeDebug(details),
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
  if (start < 0 || end < start) throw codedError("agent_output_parse_failed", "功能槽位原子化 Agent 未返回 JSON 对象");
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

function normalizeText(value, maxLength = MAX_TEXT_FIELD_LENGTH) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeStringArray(value, maxLength = MAX_ARRAY_ITEMS) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeText(item)).filter(Boolean).slice(0, maxLength);
}

function normalizeConfidence(value, fallback = 0.72) {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(0, Math.min(1, Math.round(next * 1000) / 1000));
}

function summarizeAgentOutput(message, parsed) {
  const slots = Array.isArray(parsed?.slot_map?.slots) ? parsed.slot_map.slots : [];
  return {
    messagePreview: String(message ?? "").replace(/\s+/g, " ").slice(0, 200),
    slotCount: slots.length,
    slotNames: slots.slice(0, 8).map((slot) => normalizeText(slot?.slot_name ?? slot?.slotName ?? "", 40)),
  };
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
  const schema = {
    atom_inventory: {
      script_atoms: [{
        id: "S001",
        slot: "problem_activation",
        label: "脚本原子名称",
        semantic_function: "说服任务",
        claim_type: "主张类型",
        proof_need: "证明需求",
        dependency_before: [],
        dependency_after: [],
        must_keep: [],
        replaceable_variables: [],
        source_refs: { script_segment_labels: [], shot_refs: [] },
        confidence: 0.78,
        need_review: false,
      }],
      rhythm_atoms: [{
        id: "R001",
        slot: "problem_activation",
        label: "节奏原子名称",
        attention_function: "注意力任务",
        pace: "fast_staccato",
        density_type: "cut_density",
        beat_shape: "节奏形态",
        best_for_script_functions: [],
        avoid_for: [],
        sync_points: [],
        source_refs: { rhythm_section_labels: [], shot_refs: [] },
        confidence: 0.78,
        need_review: false,
      }],
      packaging_atoms: [{
        id: "P001",
        slot: "problem_activation",
        label: "包装原子名称",
        packaging_function: "感知/证明任务",
        visual_elements: [],
        visual_hierarchy: "信息层级",
        proof_type: "证明类型",
        visual_proof_type: "视觉证明类型",
        replaceable_forms: [],
        risk: "错配风险",
        source_refs: { packaging_block_labels: [], shot_refs: [] },
        confidence: 0.78,
        need_review: false,
      }],
    },
    slot_map: {
      slots: [{
        slot_id: "F001",
        slot_order: 1,
        slot_name: "痛点激活槽",
        slot_type: "problem_activation",
        viewer_state_before: "进入前观众状态",
        viewer_state_after: "离开后观众状态",
        persuasion_task: "槽位任务",
        script_atom_ids: ["S001"],
        rhythm_atom_ids: ["R001"],
        packaging_atom_ids: ["P001"],
        required_sync_points: [],
        substitution_rules: [],
        source_refs: { shot_refs: [] },
        confidence: 0.78,
        need_review: false,
      }],
    },
    binding_graph: {
      bindings: [{
        id: "B001",
        type: "sync",
        slot_ids: ["F001"],
        atom_ids: ["S001", "R001", "P001"],
        rule: "绑定规则",
        risk_if_broken: "破坏后的风险",
        confidence: 0.78,
      }],
    },
    conflict_checks: [],
    recombination_rules: [],
    recomposition_templates: [],
  };
  return {
    schema,
    field_roles: {
      AtomCore: [
        "atom_inventory.script_atoms[].{slot,label,semantic_function,claim_type,proof_need,dependency_before,dependency_after,must_keep}",
        "atom_inventory.rhythm_atoms[].{slot,label,attention_function,pace,density_type,beat_shape,best_for_script_functions,avoid_for,sync_points}",
        "atom_inventory.packaging_atoms[].{slot,label,packaging_function,visual_hierarchy,proof_type,visual_proof_type}",
        "slot_map.slots[].{slot_order,slot_name,slot_type,viewer_state_before,viewer_state_after,persuasion_task,required_sync_points,substitution_rules}",
        "binding_graph.bindings[].{type,rule,risk_if_broken}",
        "conflict_checks[].{reason,rule,fix,applies_to}",
        "recombination_rules[].{reason,rule,fix,applies_to}",
        "recomposition_templates[].{template_name,sequence}",
      ],
      "AtomCore.Graph": [
        "slot_map.slots[].{script_atom_ids,rhythm_atom_ids,packaging_atom_ids}",
        "binding_graph.bindings[].{slot_ids,atom_ids}",
        "conflict_checks[].{slot_ids,atom_ids}",
        "recombination_rules[].{slot_ids,atom_ids}",
      ],
      SourceTrace: ["*.source_refs"],
      "Meta.StructuralMeta": [
        "*.id",
        "slot_map.slots[].slot_id",
        "recomposition_templates[].template_id",
        "conflict_checks[].source_binding_ids",
        "recombination_rules[].source_binding_ids",
      ],
      Meta: ["*.confidence", "*.need_review"],
      Mixed: [
        "atom_inventory",
        "slot_map",
        "binding_graph",
        "atom_inventory.script_atoms[].replaceable_variables",
        "atom_inventory.packaging_atoms[].visual_elements",
        "atom_inventory.packaging_atoms[].replaceable_forms",
        "atom_inventory.packaging_atoms[].risk",
      ],
    },
    role_rules: {
      AtomCore: "generation guidance: write abstract reusable structure; reviewRole will later check concrete sample leakage",
      SourceTrace: "may contain concrete sample evidence, shot refs, and source segment labels",
      Meta: "only ids, confidence, review state, or structural bookkeeping",
      Mixed: "container or unresolved mixed field; keep the original field boundary",
    },
  };
}

module.exports = {
  ROLE,
  SKILL_PATH,
  STAGES,
  MAX_TEXT_FIELD_LENGTH,
  MAX_LONG_TEXT_FIELD_LENGTH,
  MAX_ARRAY_ITEMS,
  MAX_RULES,
  MAX_SLOTS,
  MAX_ATOMS,
  codedError,
  safeError,
  sanitizeDebugPayload,
  sanitizeForAppServerText,
  extractJsonObject,
  contentHash,
  resolveSkillHash,
  normalizeText,
  normalizeStringArray,
  normalizeConfidence,
  summarizeAgentOutput,
  stableJson,
  buildOutputContract,
};
