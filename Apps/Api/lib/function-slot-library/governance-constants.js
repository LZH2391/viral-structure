const path = require("path");

const ROLE = "function-slot-library-builder";
const SAMPLE_VIDEO_ID = "function-slot-library";
const ARTIFACT_TYPE = "function-slot-semantic-governance";
const GOVERNANCE_RELATIVE_PATH = "Artifacts/FunctionSlotLibrary/_governance/semantic-governance.v1.json";
const GOVERNANCE_LOOKUP_INDEX_RELATIVE_PATH = "Runtime/Temp/FunctionSlotLibrary/governance_lookup_index.json";
const GOVERNANCE_MATERIALIZED_RELATIVE_PATH = "Runtime/Temp/FunctionSlotLibrary/semantic-governance.materialized.json";
const SLOT_INDEX_RELATIVE_PATH = "Runtime/Temp/FunctionSlotLibrary/slot_index.json";
const VALIDATION_RELATIVE_PATH = "Runtime/Temp/FunctionSlotLibrary/validation.json";
const STAGES = {
  evidence: "function_slot_library.semantic_governance.evidence_refresh",
  analyze: "function_slot_library.semantic_governance.agent_analyze",
  validate: "function_slot_library.semantic_governance.validate",
  repair: "function_slot_library.semantic_governance.agent_repair",
  materialize: "function_slot_library.semantic_governance.materialize",
};
const DEFAULT_SKILL_SCRIPT_DIR = path.join(process.cwd(), ".agents", "skills", "function-slot-library-builder", "scripts");
const DEFAULT_REFERENCE_DIR = path.join(process.cwd(), ".agents", "skills", "function-slot-library-builder", "references");

module.exports = {
  ROLE,
  SAMPLE_VIDEO_ID,
  ARTIFACT_TYPE,
  GOVERNANCE_RELATIVE_PATH,
  GOVERNANCE_LOOKUP_INDEX_RELATIVE_PATH,
  GOVERNANCE_MATERIALIZED_RELATIVE_PATH,
  SLOT_INDEX_RELATIVE_PATH,
  VALIDATION_RELATIVE_PATH,
  STAGES,
  DEFAULT_SKILL_SCRIPT_DIR,
  DEFAULT_REFERENCE_DIR,
};
